"""Per-user Gmail API client.

Credentials come from each user's stored `GoogleCredential` row (captured at
login, see auth/routes.py), decrypted per call. This file used to build and
cache a single global `googleapiclient` service for one shared, locally
authorized account -- naively parameterizing that by user without removing
the cache would make every scan after the first silently reuse the first
user's Gmail access, so there is intentionally no module-level service cache
here anymore.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, TypedDict

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from sqlalchemy import select

from auth.crypto import decrypt, encrypt
from config.settings import settings
from db.database import get_session
from db.models import GoogleCredential

logger = logging.getLogger(__name__)

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


class GmailMessage(TypedDict, total=False):
    id: str
    subject: str
    snippet: str
    from_addr: str
    date: str


class GmailNotConnected(Exception):
    """Raised when a user has no usable stored Gmail credential."""


def _load_credential_row(user_id: int) -> GoogleCredential | None:
    with get_session() as session:
        row = session.execute(
            select(GoogleCredential).where(GoogleCredential.user_id == user_id)
        ).scalar_one_or_none()
        if row is not None:
            session.expunge(row)
        return row


def _persist_refreshed_token(user_id: int, access_token: str, expiry: datetime | None) -> None:
    with get_session() as session:
        row = session.execute(
            select(GoogleCredential).where(GoogleCredential.user_id == user_id)
        ).scalar_one_or_none()
        if row is not None:
            row.access_token_enc = encrypt(access_token)
            row.token_expiry = expiry


def _build_service_sync(user_id: int) -> Any:
    row = _load_credential_row(user_id)
    if row is None or not row.refresh_token_enc:
        raise GmailNotConnected(f"User {user_id} has no connected Gmail account")

    creds = Credentials(
        token=decrypt(row.access_token_enc),
        refresh_token=decrypt(row.refresh_token_enc),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=GMAIL_SCOPES,
        expiry=row.token_expiry,
    )
    if not creds.valid:
        creds.refresh(Request())
        _persist_refreshed_token(user_id, creds.token, creds.expiry)

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _header(headers: list[dict[str, str]], name: str) -> str:
    target = name.lower()
    for h in headers:
        if h.get("name", "").lower() == target:
            return h.get("value", "")
    return ""


def _search_sync(user_id: int, query: str, max_results: int) -> list[GmailMessage]:
    svc = _build_service_sync(user_id)
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


async def search_messages(user_id: int, query: str, max_results: int = 50) -> list[GmailMessage]:
    """Run a Gmail search scoped to one user. Returns [] on failure (logged)."""
    try:
        return await asyncio.to_thread(_search_sync, user_id, query, max_results)
    except GmailNotConnected:
        return []
    except Exception as exc:
        logger.warning("Gmail search failed for user %s, query %r: %s", user_id, query, exc)
        return []
