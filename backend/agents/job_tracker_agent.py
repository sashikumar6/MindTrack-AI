"""Gmail API + GPT-4o job application classifier."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import TypedDict

from openai import AsyncOpenAI
from sqlalchemy import select

from agents.gmail_client import search_messages
from config.settings import settings
from db.database import get_session
from db.models import JobMetric

logger = logging.getLogger(__name__)


class ClassifiedEmail(TypedDict):
    status: str
    company: str | None
    job_title: str | None
    source: str


SEARCH_QUERIES: list[str] = [
    # ---- Application acknowledgements ----
    'from:linkedin.com "application was sent"',
    'subject:"thanks for applying"',
    'subject:"thank you for applying"',
    'subject:"thank you for your application"',
    'subject:"application received"',
    'subject:"we received your application"',
    'subject:"application confirmation"',
    'subject:"application submitted"',
    # ---- Status / update style (could be either applied or rejected) ----
    'subject:"application update"',
    'subject:"your application"',
    'subject:"update on your application"',
    'subject:"regarding your application"',
    'subject:"status update"',
    'subject:"hiring update"',
    'subject:"hiring decision"',
    'subject:"decision on your application"',
    # ---- Rejection language ----
    '"move forward with other candidates"',
    '"after careful consideration"',
    '"we regret to inform"',
    '"unfortunately, we"',
    '"position has been filled"',
    '"role has been filled"',
    '"not selected"',
    '"unable to offer you"',
    # ---- Interview / next-steps ----
    'subject:"interview"',
    'subject:"next steps"',
    'subject:"schedule a call"',
    'subject:"phone screen"',
]

CLASSIFIER_SYSTEM_PROMPT = (
    "You are a job application email classifier. Given an email subject and "
    "snippet, classify it and extract structured data. Return JSON only, no "
    "extra text.\n\n"
    "Return:\n"
    "{\n"
    '  "status": "applied" | "rejected" | "interview" | "offer" | "irrelevant",\n'
    '  "company": "company name or null",\n'
    '  "job_title": "role title or null",\n'
    '  "source": "linkedin" | "company_site" | "unknown"\n'
    "}"
)

GHOSTED_THRESHOLD_DAYS = 30


def _parse_email_date(value: str) -> date | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
        try:
            return datetime.strptime(value[: len(fmt) + 6], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromtimestamp(int(value) / 1000).date()
    except (ValueError, OSError):
        return None


_openai_client: AsyncOpenAI | None = None


def _client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_client


async def classify_email(subject: str, snippet: str) -> ClassifiedEmail:
    resp = await _client().chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": CLASSIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Subject: {subject}\nSnippet: {snippet}"},
        ],
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "irrelevant", "company": None, "job_title": None, "source": "unknown"}

    status = data.get("status", "irrelevant")
    if status not in {"applied", "rejected", "interview", "offer", "irrelevant"}:
        status = "irrelevant"
    source = data.get("source", "unknown")
    if source not in {"linkedin", "company_site", "unknown"}:
        source = "unknown"
    return {
        "status": status,
        "company": data.get("company") or None,
        "job_title": data.get("job_title") or None,
        "source": source,
    }


async def scan_gmail(since_days: int = 7) -> int:
    """Scan recent Gmail, classify, persist new rows. Returns count added.

    `since_days` bounds the search via Gmail's `newer_than` operator so daily
    runs stay fast and don't re-process the entire mailbox. Defaults to 7d
    (one-week safety window; dedup on email subject handles overlap).
    """
    with get_session() as session:
        seen = {
            eid for eid in session.execute(select(JobMetric.email_id)).scalars().all() if eid
        }

    window = f"newer_than:{max(1, since_days)}d"
    new_rows: list[JobMetric] = []
    for query in SEARCH_QUERIES:
        messages = await search_messages(f"{query} {window}")
        for msg in messages:
            email_id = msg.get("id", "").strip()
            subject = msg.get("subject", "").strip()
            if not email_id or email_id in seen:
                continue
            seen.add(email_id)

            try:
                cls = await classify_email(subject, msg.get("snippet", ""))
            except Exception as exc:
                logger.warning("Classifier failed for %r: %s", subject, exc)
                continue

            if cls["status"] == "irrelevant":
                continue

            email_day = _parse_email_date(msg.get("date", ""))
            applied_day = email_day if cls["status"] == "applied" else None
            response_day = email_day if cls["status"] in {"rejected", "interview", "offer"} else None

            new_rows.append(
                JobMetric(
                    email_id=email_id,
                    company=cls["company"],
                    job_title=cls["job_title"],
                    status=cls["status"],
                    source=cls["source"],
                    email_subject=subject,
                    email_snippet=msg.get("snippet", ""),
                    applied_date=applied_day,
                    response_date=response_day,
                )
            )

    if new_rows:
        with get_session() as session:
            session.add_all(new_rows)

    await mark_ghosted()
    return len(new_rows)


async def mark_ghosted(threshold_days: int = GHOSTED_THRESHOLD_DAYS) -> int:
    """Flag stale 'applied' rows with no response as 'ghosted'. Returns rows updated."""
    cutoff = date.today() - timedelta(days=threshold_days)
    with get_session() as session:
        stale = (
            session.execute(
                select(JobMetric).where(
                    JobMetric.status == "applied",
                    JobMetric.applied_date.is_not(None),
                    JobMetric.applied_date <= cutoff,
                    JobMetric.response_date.is_(None),
                )
            )
            .scalars()
            .all()
        )
        for entry in stale:
            entry.status = "ghosted"
        return len(stale)
