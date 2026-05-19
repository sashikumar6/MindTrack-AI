"""Direct Gmail API client. Reads token.json (created by scripts/auth_gmail.py)
and refreshes silently on expiry. Returns messages in the same shape the old
MCP layer used so the rest of the job-tracker agent is unchanged."""
from __future__ import annotations

import asyncio
import base64
import logging
from pathlib import Path
from typing import Any, TypedDict

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from config.settings import settings

logger = logging.getLogger(__name__)

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


class GmailMessage(TypedDict, total=False):
    id: str
    subject: str
    snippet: str
    from_addr: str
    date: str


_service: Any = None


def _load_service() -> Any:
    global _service
    if _service is not None:
        return _service

    token_path = Path(settings.GOOGLE_TOKEN_PATH)
    if not token_path.exists():
        raise FileNotFoundError(
            f"Gmail token not found at {token_path}. "
            "Run `python scripts/auth_gmail.py` once to authorize."
        )

    creds = Credentials.from_authorized_user_file(str(token_path), GMAIL_SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            token_path.write_text(creds.to_json())
        else:
            raise RuntimeError("Gmail credentials invalid; re-run auth_gmail.py.")

    _service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return _service


def _header(headers: list[dict[str, str]], name: str) -> str:
    target = name.lower()
    for h in headers:
        if h.get("name", "").lower() == target:
            return h.get("value", "")
    return ""


def _search_sync(query: str, max_results: int) -> list[GmailMessage]:
    svc = _load_service()
    listing = (
        svc.users()
        .messages()
        .list(userId="me", q=query, maxResults=max_results)
        .execute()
    )
    out: list[GmailMessage] = []
    for stub in listing.get("messages", []) or []:
        msg = (
            svc.users()
            .messages()
            .get(
                userId="me",
                id=stub["id"],
                format="metadata",
                metadataHeaders=["Subject", "From", "Date"],
            )
            .execute()
        )
        headers = msg.get("payload", {}).get("headers", [])
        out.append(
            {
                "id": msg.get("id", ""),
                "subject": _header(headers, "Subject"),
                "snippet": msg.get("snippet", ""),
                "from_addr": _header(headers, "From"),
                "date": msg.get("internalDate", ""),
            }
        )
    return out


async def search_messages(query: str, max_results: int = 50) -> list[GmailMessage]:
    """Run Gmail search. Returns [] on failure (logged)."""
    try:
        return await asyncio.to_thread(_search_sync, query, max_results)
    except Exception as exc:
        logger.warning("Gmail search failed for %r: %s", query, exc)
        return []
