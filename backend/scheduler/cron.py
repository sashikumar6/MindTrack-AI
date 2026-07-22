"""APScheduler entry point.

Runs one daily sweep across every user who has connected Gmail (rather than
registering a per-user job) -- simplest robust option for a single-instance
deployment; see DESIGN.md's note on multi-replica scheduling if this ever
needs to scale beyond one process.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def daily_gmail_sweep() -> None:
    from db.database import get_session
    from db.models import GoogleCredential
    from agents.job_tracker_agent import scan_gmail

    with get_session() as session:
        user_ids = [
            row.user_id
            for row in session.execute(
                select(GoogleCredential).where(GoogleCredential.refresh_token_enc.is_not(None))
            )
            .scalars()
            .all()
        ]

    for user_id in user_ids:
        try:
            added = await scan_gmail(user_id)
            logger.info("Gmail sweep: user %s, %d new job entries", user_id, added)
        except Exception:
            logger.exception("Gmail sweep failed for user %s", user_id)


def register_jobs() -> None:
    """Register the 8am daily Gmail sweep across all connected users."""
    scheduler.add_job(
        daily_gmail_sweep, CronTrigger(hour=8, minute=0), id="daily_gmail_sweep", replace_existing=True
    )


def start() -> None:
    register_jobs()
    scheduler.start()


def shutdown() -> None:
    scheduler.shutdown(wait=False)
