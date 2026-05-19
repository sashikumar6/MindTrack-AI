"""APScheduler entry point. Base scaffold."""
from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()


def register_jobs() -> None:
    """Register: 8am daily Gmail scan, Sunday 9pm weekly summary."""
    from agents.job_tracker_agent import scan_gmail

    scheduler.add_job(scan_gmail, CronTrigger(hour=8, minute=0), id="daily_gmail_scan", replace_existing=True)


def start() -> None:
    register_jobs()
    scheduler.start()


def shutdown() -> None:
    scheduler.shutdown(wait=False)
