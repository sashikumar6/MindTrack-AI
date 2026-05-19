import logging
import tempfile
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select

from agents.job_tracker_agent import scan_gmail
from agents.mood_agent import run_mood_pipeline
from db.database import get_session, init_db
from db.models import JobMetric, MoodEntry
from scheduler.cron import shutdown as scheduler_shutdown
from scheduler.cron import start as scheduler_start
from voice.whisper_stt import transcribe

logger = logging.getLogger(__name__)

JOB_STATUSES = ("applied", "rejected", "interview", "ghosted")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler_start()
    try:
        yield
    finally:
        scheduler_shutdown()


app = FastAPI(title="MindTrack AI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class MoodTextRequest(BaseModel):
    text: str


def _serialize_job(row: JobMetric) -> dict[str, Any]:
    return {
        "id": row.id,
        "detected_at": row.detected_at.isoformat() if row.detected_at else None,
        "company": row.company,
        "job_title": row.job_title,
        "status": row.status,
        "source": row.source,
        "email_subject": row.email_subject,
        "email_snippet": row.email_snippet,
        "applied_date": row.applied_date.isoformat() if row.applied_date else None,
        "response_date": row.response_date.isoformat() if row.response_date else None,
    }


def _serialize_mood(row: MoodEntry) -> dict[str, Any]:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "transcript": row.raw_transcript,
        "mood_score": row.mood_score,
        "energy_level": row.energy_level,
        "anxiety_level": row.anxiety_level,
        "keywords": [k for k in (row.keywords or "").split(",") if k],
        "summary": row.summary,
        "agent_response": row.agent_response,
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------- Jobs ----------

@app.post("/jobs/scan")
async def jobs_scan() -> dict[str, Any]:
    new_count = await scan_gmail()
    return {"new_entries": new_count}


@app.get("/jobs/history")
async def jobs_history(limit: int = 100) -> list[dict[str, Any]]:
    with get_session() as session:
        rows = (
            session.execute(
                select(JobMetric).order_by(JobMetric.detected_at.desc()).limit(limit)
            )
            .scalars()
            .all()
        )
        return [_serialize_job(r) for r in rows]


@app.get("/jobs/stats")
async def jobs_stats() -> dict[str, Any]:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(days=7)

    totals = {s: 0 for s in JOB_STATUSES}
    today_counts = {s: 0 for s in JOB_STATUSES}
    this_week = {s: 0 for s in JOB_STATUSES}
    last_week = {s: 0 for s in JOB_STATUSES}

    with get_session() as session:
        rows = session.execute(select(JobMetric)).scalars().all()

    for r in rows:
        if r.status not in totals:
            continue
        totals[r.status] += 1
        # Bucket by the email's actual date, not the scanner's detection time.
        # Applied/ghosted use the application date; rejected/interview use
        # the response date.
        when = r.applied_date if r.status in ("applied", "ghosted") else r.response_date
        if when is None:
            continue
        if when == today:
            today_counts[r.status] += 1
        if when >= week_start:
            this_week[r.status] += 1
        elif last_week_start <= when < week_start:
            last_week[r.status] += 1

    return {
        "totals": totals,
        "today": today_counts,
        "this_week": this_week,
        "last_week": last_week,
        "delta": {s: this_week[s] - last_week[s] for s in JOB_STATUSES},
    }


@app.get("/jobs/timeline")
async def jobs_timeline(days: int = 14) -> list[dict[str, Any]]:
    today = date.today()
    start = today - timedelta(days=days - 1)

    buckets: dict[date, dict[str, int]] = {
        start + timedelta(days=i): {s: 0 for s in JOB_STATUSES} for i in range(days)
    }

    with get_session() as session:
        rows = session.execute(select(JobMetric)).scalars().all()

    for r in rows:
        if r.status not in JOB_STATUSES:
            continue
        d = r.applied_date if r.status in ("applied", "ghosted") else r.response_date
        if d in buckets:
            buckets[d][r.status] += 1

    return [{"day": d.isoformat(), **buckets[d]} for d in sorted(buckets)]


# ---------- Mood ----------

@app.post("/mood/text")
async def mood_text(body: MoodTextRequest) -> dict[str, Any]:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    return await run_mood_pipeline(body.text)


@app.post("/mood/audio")
async def mood_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty audio upload")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(payload)
        tmp_path = Path(tmp.name)

    try:
        transcript = await transcribe(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not transcript:
        raise HTTPException(status_code=422, detail="No speech detected")

    return await run_mood_pipeline(transcript)


@app.get("/mood/history")
async def mood_history(days: int = 30, limit: int = 100) -> list[dict[str, Any]]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    with get_session() as session:
        rows = (
            session.execute(
                select(MoodEntry)
                .where(MoodEntry.created_at >= cutoff)
                .order_by(MoodEntry.created_at.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return [_serialize_mood(r) for r in rows]


@app.get("/mood/stats")
async def mood_stats(days: int = 7) -> list[dict[str, Any]]:
    today = date.today()
    start = today - timedelta(days=days - 1)
    start_dt = datetime.combine(start, datetime.min.time())

    with get_session() as session:
        rows = (
            session.execute(select(MoodEntry).where(MoodEntry.created_at >= start_dt))
            .scalars()
            .all()
        )

    buckets: dict[date, list[MoodEntry]] = {
        start + timedelta(days=i): [] for i in range(days)
    }
    for r in rows:
        d = r.created_at.date() if r.created_at else None
        if d in buckets:
            buckets[d].append(r)

    out: list[dict[str, Any]] = []
    for d in sorted(buckets):
        items = buckets[d]
        if items:
            n = len(items)
            out.append(
                {
                    "day": d.isoformat(),
                    "mood": round(sum(i.mood_score or 0 for i in items) / n, 2),
                    "energy": round(sum(i.energy_level or 0 for i in items) / n, 2),
                    "anxiety": round(sum(i.anxiety_level or 0 for i in items) / n, 2),
                    "entries": n,
                }
            )
        else:
            out.append({"day": d.isoformat(), "mood": None, "energy": None, "anxiety": None, "entries": 0})
    return out


@app.get("/mood/weekly")
async def mood_weekly(span: int = 30, window: int = 7) -> list[dict[str, Any]]:
    today = date.today()
    start = today - timedelta(days=span - 1)
    cutoff = start - timedelta(days=window - 1)
    cutoff_dt = datetime.combine(cutoff, datetime.min.time())

    with get_session() as session:
        rows = (
            session.execute(select(MoodEntry).where(MoodEntry.created_at >= cutoff_dt))
            .scalars()
            .all()
        )

    by_day: dict[date, list[MoodEntry]] = {}
    for r in rows:
        if r.created_at is None:
            continue
        by_day.setdefault(r.created_at.date(), []).append(r)

    out: list[dict[str, Any]] = []
    for i in range(span):
        d = start + timedelta(days=i)
        bucket: list[MoodEntry] = []
        for j in range(window):
            bucket.extend(by_day.get(d - timedelta(days=j), []))
        if bucket:
            n = len(bucket)
            out.append(
                {
                    "day": d.isoformat(),
                    "mood": round(sum(b.mood_score or 0 for b in bucket) / n, 2),
                    "energy": round(sum(b.energy_level or 0 for b in bucket) / n, 2),
                    "anxiety": round(sum(b.anxiety_level or 0 for b in bucket) / n, 2),
                }
            )
        else:
            out.append({"day": d.isoformat(), "mood": None, "energy": None, "anxiety": None})
    return out


# ---------- Combined ----------

@app.get("/dashboard")
async def dashboard() -> dict[str, Any]:
    return {
        "jobs": {
            "stats": await jobs_stats(),
            "timeline": await jobs_timeline(),
            "recent": await jobs_history(limit=10),
        },
        "mood": {
            "stats": await mood_stats(),
            "history": await mood_history(days=30, limit=10),
        },
    }
