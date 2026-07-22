import logging
import tempfile
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from starlette.middleware.sessions import SessionMiddleware

import base64

from agents.job_tracker_agent import scan_gmail
from agents.mood_agent import run_mood_pipeline
from agents.mood_conversation import (
    get_session_transcript,
    list_sessions,
    process_turn,
    process_turn_streaming,
    start_session,
)
from agents.personas import DEFAULT_PERSONA
from auth.deps import get_current_user, get_current_user_optional, get_current_user_ws
from auth.routes import router as auth_router
from config.settings import settings
from db.database import get_session, init_db
from db.models import JobMetric, MoodEntry, User
from scheduler.cron import shutdown as scheduler_shutdown
from scheduler.cron import start as scheduler_start
from voice.elevenlabs_tts import synthesize, synthesize_stream
from voice.whisper_stt import transcribe

logger = logging.getLogger(__name__)

JOB_STATUSES = ("applied", "rejected", "interview", "ghosted")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if settings.ENABLE_JOB_TRACKER:
        scheduler_start()
    try:
        yield
    finally:
        if settings.ENABLE_JOB_TRACKER:
            scheduler_shutdown()


app = FastAPI(title="MindTrack AI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

# --- Rate limiting -----------------------------------------------------
# Two independent limiters so one population can't starve the other:
# anonymous/demo traffic (global, unkeyed -- there's no identity to key on)
# and authenticated traffic (keyed per user). Shared between the HTTP
# middleware below and the WebSocket voice endpoint, since the middleware
# only ever sees HTTP requests -- a WS handshake is a GET, and turns sent
# over an open socket never pass through HTTP middleware at all.
_anon_post_timestamps: deque[float] = deque()
_user_post_timestamps: dict[int, deque[float]] = {}


def _over_limit(bucket: deque[float], limit: int) -> bool:
    now = time.monotonic()
    cutoff = now - 3600
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        return True
    bucket.append(now)
    return False


def _turn_rate_limited(user_id: int | None) -> bool:
    if user_id is None:
        return _over_limit(_anon_post_timestamps, settings.DEMO_MAX_POSTS_PER_HOUR)
    bucket = _user_post_timestamps.setdefault(user_id, deque())
    return _over_limit(bucket, settings.DEMO_MAX_POSTS_PER_HOUR_PER_USER)


@app.middleware("http")
async def demo_budget_guard(request: Request, call_next):
    """Bound POST traffic so usage (demo or real) can't create runaway API spend."""
    if request.method == "POST" and request.url.path.startswith("/mood/"):
        user_id = request.session.get("user_id")
        if _turn_rate_limited(user_id):
            detail = (
                "Usage limit reached. Please try again later."
                if user_id is not None
                else "Demo usage limit reached. Please try again later."
            )
            return JSONResponse(status_code=429, content={"detail": detail})
    return await call_next(request)


# SessionMiddleware must be added AFTER demo_budget_guard above so that it
# ends up OUTER in the middleware stack (Starlette wraps middleware in
# reverse add-order) and populates request.session before demo_budget_guard
# runs -- verified empirically, not just by reading docs, since getting this
# backwards would make request.session unavailable to the limiter.
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET_KEY,
    same_site="lax",
    https_only=settings.SESSION_HTTPS_ONLY,
    max_age=60 * 60 * 24 * 30,
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
# All job-tracker endpoints require login: job tracking is inherently
# per-user Gmail data, there is no anonymous/demo job tracker.

@app.post("/jobs/scan")
async def jobs_scan(user: User = Depends(get_current_user)) -> dict[str, Any]:
    if not settings.ENABLE_JOB_TRACKER:
        raise HTTPException(status_code=503, detail="Job tracker is disabled in this demo")
    new_count = await scan_gmail(user.id)
    return {"new_entries": new_count}


async def _jobs_history(user_id: int, limit: int) -> list[dict[str, Any]]:
    with get_session() as session:
        rows = (
            session.execute(
                select(JobMetric)
                .where(JobMetric.user_id == user_id)
                .order_by(JobMetric.detected_at.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return [_serialize_job(r) for r in rows]


@app.get("/jobs/history")
async def jobs_history(
    limit: int = 100, user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    return await _jobs_history(user.id, limit)


async def _jobs_stats(user_id: int) -> dict[str, Any]:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    last_week_start = week_start - timedelta(days=7)

    totals = {s: 0 for s in JOB_STATUSES}
    today_counts = {s: 0 for s in JOB_STATUSES}
    this_week = {s: 0 for s in JOB_STATUSES}
    last_week = {s: 0 for s in JOB_STATUSES}

    with get_session() as session:
        rows = (
            session.execute(select(JobMetric).where(JobMetric.user_id == user_id))
            .scalars()
            .all()
        )

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


@app.get("/jobs/stats")
async def jobs_stats(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return await _jobs_stats(user.id)


async def _jobs_timeline(user_id: int, days: int) -> list[dict[str, Any]]:
    today = date.today()
    start = today - timedelta(days=days - 1)

    buckets: dict[date, dict[str, int]] = {
        start + timedelta(days=i): {s: 0 for s in JOB_STATUSES} for i in range(days)
    }

    with get_session() as session:
        rows = (
            session.execute(select(JobMetric).where(JobMetric.user_id == user_id))
            .scalars()
            .all()
        )

    for r in rows:
        if r.status not in JOB_STATUSES:
            continue
        d = r.applied_date if r.status in ("applied", "ghosted") else r.response_date
        if d in buckets:
            buckets[d][r.status] += 1

    return [{"day": d.isoformat(), **buckets[d]} for d in sorted(buckets)]


@app.get("/jobs/timeline")
async def jobs_timeline(
    days: int = 14, user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    return await _jobs_timeline(user.id, days)


# ---------- Mood ----------
# The one-shot and conversational check-in endpoints accept an *optional*
# current user (get_current_user_optional): logged-out visitors still get
# today's ephemeral, non-persisted, memory-free "demo" behavior, while
# logged-in users always get persistent history -- this is now a per-request
# decision (is the caller authenticated?), not a global DEMO_MODE setting,
# since both kinds of traffic can be in flight in the same process.

def _persona_and_voice(user: User | None) -> tuple[str, str | None]:
    """Read the caller's persisted coach-tone/voice preference, if any.

    Anonymous callers (user is None) always get the global defaults --
    there's no row to read a preference from, matching the rest of the
    anonymous/ephemeral demo behavior.
    """
    if user is None:
        return DEFAULT_PERSONA, None
    return user.persona_mode, user.tts_voice


@app.post("/mood/text")
async def mood_text(
    body: MoodTextRequest, user: User | None = Depends(get_current_user_optional)
) -> dict[str, Any]:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    if len(body.text) > settings.MAX_TEXT_CHARS:
        raise HTTPException(status_code=413, detail="Text check-in is too long")
    persona, voice = _persona_and_voice(user)
    return await run_mood_pipeline(body.text, user.id if user else None, persona, voice)


@app.post("/mood/audio")
async def mood_audio(
    file: UploadFile = File(...), user: User | None = Depends(get_current_user_optional)
) -> dict[str, Any]:
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(payload) > settings.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio upload is too large")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(payload)
        tmp_path = Path(tmp.name)

    try:
        transcript = await transcribe(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    if not transcript:
        raise HTTPException(status_code=422, detail="No speech detected")

    persona, voice = _persona_and_voice(user)
    return await run_mood_pipeline(transcript, user.id if user else None, persona, voice)


# ---------- Mood (conversational, agentic) ----------

async def _audio_b64(text: str, voice: str | None = None) -> str:
    audio = await synthesize(text, voice=voice)
    return base64.b64encode(audio).decode("ascii") if audio else ""


async def _transcribe_upload(file: UploadFile) -> str:
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(payload) > settings.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio upload is too large")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(payload)
        tmp_path = Path(tmp.name)
    try:
        text = await transcribe(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    if not text:
        raise HTTPException(status_code=422, detail="No speech detected")
    return text


@app.post("/mood/session/start")
async def mood_session_start(
    user: User | None = Depends(get_current_user_optional),
) -> dict[str, Any]:
    persona, voice = _persona_and_voice(user)
    result = await start_session(user.id if user else None, persona)
    result["audio_b64"] = await _audio_b64(result["agent_message"], voice)
    return result


class MoodTurnTextRequest(BaseModel):
    session_id: int
    text: str


@app.post("/mood/session/turn/text")
async def mood_session_turn_text(
    body: MoodTurnTextRequest, user: User | None = Depends(get_current_user_optional)
) -> dict[str, Any]:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    if len(body.text) > settings.MAX_TEXT_CHARS:
        raise HTTPException(status_code=413, detail="Text check-in is too long")
    persona, voice = _persona_and_voice(user)
    try:
        result = await process_turn(body.session_id, body.text, user.id if user else None, persona)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    result["audio_b64"] = await _audio_b64(result["agent_message"], voice)
    result["user_transcript"] = body.text
    return result


@app.post("/mood/session/turn/audio")
async def mood_session_turn_audio(
    session_id: int,
    file: UploadFile = File(...),
    user: User | None = Depends(get_current_user_optional),
) -> dict[str, Any]:
    transcript = await _transcribe_upload(file)
    persona, voice = _persona_and_voice(user)
    try:
        result = await process_turn(session_id, transcript, user.id if user else None, persona)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    result["audio_b64"] = await _audio_b64(result["agent_message"], voice)
    result["user_transcript"] = transcript
    return result


@app.get("/mood/session/{session_id}")
async def mood_session_get(
    session_id: int, user: User = Depends(get_current_user)
) -> dict[str, Any]:
    data = get_session_transcript(session_id, user.id)
    if data is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return data


@app.get("/mood/sessions")
async def mood_sessions(
    limit: int = 30, before: int | None = None, user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    return list_sessions(user.id, limit, before)


# ---------- Mood (conversational, streamed over WebSocket) ----------
# Lower-latency transport for the live voice UI: text renders per sentence
# as the coach response is generated, and each sentence's TTS audio streams
# to the client as soon as it's synthesized, instead of the REST turn
# endpoints' "wait for the whole reply, then send text+audio together."
# REST stays in place above for text-only/back-compat callers.

_ALLOWED_WS_ORIGINS = {o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()}


def _origin_allowed(origin: str | None) -> bool:
    # CORSMiddleware does not protect WebSocket handshakes at all (browsers
    # don't apply the same-origin/CORS model to WS the way they do to
    # fetch/XHR), so this is the only thing standing between this endpoint
    # and cross-site WebSocket hijacking -- check it explicitly.
    if origin is None:
        # Non-browser clients (curl, server-to-server) send no Origin header;
        # browsers always send one on a WS handshake, so this only affects
        # non-browser callers, which is fine to allow.
        return True
    return origin in _ALLOWED_WS_ORIGINS


@app.websocket("/ws/mood/session/{session_id}")
async def mood_session_ws(websocket: WebSocket, session_id: int) -> None:
    if not _origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=4403)
        return

    await websocket.accept()
    # Raising HTTPException (what get_current_user does) doesn't translate
    # to a clean WS close, so get_current_user_ws returns None instead --
    # matching the REST turn endpoints, this allows anonymous/demo callers
    # too; process_turn_streaming enforces session ownership per turn.
    user = await get_current_user_ws(websocket)
    user_id = user.id if user else None
    # Persona/voice are the user's persisted Settings preference, read once
    # for the lifetime of this connection -- a change made in another tab
    # mid-conversation takes effect on the *next* session, not retroactively.
    persona, voice = _persona_and_voice(user)

    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")

            if msg_type == "text_turn":
                text = str(msg.get("text") or "").strip()
                if not text:
                    await websocket.send_json({"type": "error", "detail": "Empty text"})
                    continue
                if len(text) > settings.MAX_TEXT_CHARS:
                    await websocket.send_json(
                        {"type": "error", "detail": "Text check-in is too long"}
                    )
                    continue
                user_message = text

            elif msg_type == "audio_turn":
                try:
                    payload = base64.b64decode(str(msg.get("data") or ""))
                except Exception:
                    await websocket.send_json({"type": "error", "detail": "Invalid audio payload"})
                    continue
                if not payload:
                    await websocket.send_json({"type": "error", "detail": "Empty audio upload"})
                    continue
                if len(payload) > settings.MAX_AUDIO_BYTES:
                    await websocket.send_json(
                        {"type": "error", "detail": "Audio upload is too large"}
                    )
                    continue
                suffix = ".mp4" if "mp4" in str(msg.get("mime") or "") else ".webm"
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp.write(payload)
                    tmp_path = Path(tmp.name)
                try:
                    user_message = await transcribe(tmp_path)
                finally:
                    tmp_path.unlink(missing_ok=True)
                if not user_message:
                    await websocket.send_json({"type": "error", "detail": "No speech detected"})
                    continue
                await websocket.send_json({"type": "transcript", "text": user_message})

            else:
                await websocket.send_json(
                    {"type": "error", "detail": f"Unknown message type: {msg_type}"}
                )
                continue

            if _turn_rate_limited(user_id):
                detail = (
                    "Usage limit reached. Please try again later."
                    if user_id is not None
                    else "Demo usage limit reached. Please try again later."
                )
                await websocket.send_json({"type": "error", "detail": detail})
                continue

            try:
                async for event in process_turn_streaming(
                    session_id, user_message, user_id, persona
                ):
                    if event["type"] == "vibe":
                        await websocket.send_json({"type": "vibe", "vibe": event["vibe"]})
                    elif event["type"] == "text_delta":
                        sentence = event["text"]
                        await websocket.send_json({"type": "text_delta", "text": sentence})
                        seq = 0
                        async for chunk in synthesize_stream(sentence, voice):
                            await websocket.send_json(
                                {
                                    "type": "audio_chunk",
                                    "seq": seq,
                                    "data": base64.b64encode(chunk).decode("ascii"),
                                }
                            )
                            seq += 1
                        await websocket.send_json({"type": "sentence_done"})
                    elif event["type"] == "turn_complete":
                        rest = {k: v for k, v in event.items() if k != "type"}
                        await websocket.send_json({"type": "turn_done", **rest})
            except ValueError as exc:
                await websocket.send_json({"type": "error", "detail": str(exc)})
            except Exception:
                logger.exception("Streaming turn failed for session %s", session_id)
                await websocket.send_json(
                    {"type": "error", "detail": "Something went wrong processing that turn."}
                )
    except WebSocketDisconnect:
        return


async def _mood_history(user_id: int, days: int, limit: int) -> list[dict[str, Any]]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    with get_session() as session:
        rows = (
            session.execute(
                select(MoodEntry)
                .where(MoodEntry.user_id == user_id, MoodEntry.created_at >= cutoff)
                .order_by(MoodEntry.created_at.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return [_serialize_mood(r) for r in rows]


@app.get("/mood/history")
async def mood_history(
    days: int = 30, limit: int = 100, user: User | None = Depends(get_current_user_optional)
) -> list[dict[str, Any]]:
    if user is None:
        return []
    return await _mood_history(user.id, days, limit)


async def _mood_stats(user_id: int, days: int) -> list[dict[str, Any]]:
    today = date.today()
    start = today - timedelta(days=days - 1)
    start_dt = datetime.combine(start, datetime.min.time())

    with get_session() as session:
        rows = (
            session.execute(
                select(MoodEntry).where(
                    MoodEntry.user_id == user_id, MoodEntry.created_at >= start_dt
                )
            )
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


@app.get("/mood/stats")
async def mood_stats(
    days: int = 7, user: User | None = Depends(get_current_user_optional)
) -> list[dict[str, Any]]:
    if user is None:
        today = date.today()
        start = today - timedelta(days=days - 1)
        return [
            {
                "day": (start + timedelta(days=i)).isoformat(),
                "mood": None,
                "energy": None,
                "anxiety": None,
                "entries": 0,
            }
            for i in range(days)
        ]
    return await _mood_stats(user.id, days)


@app.get("/mood/weekly")
async def mood_weekly(
    span: int = 30, window: int = 7, user: User | None = Depends(get_current_user_optional)
) -> list[dict[str, Any]]:
    today = date.today()
    start = today - timedelta(days=span - 1)

    if user is None:
        return [{"day": (start + timedelta(days=i)).isoformat(), "mood": None, "energy": None, "anxiety": None} for i in range(span)]

    cutoff = start - timedelta(days=window - 1)
    cutoff_dt = datetime.combine(cutoff, datetime.min.time())

    with get_session() as session:
        rows = (
            session.execute(
                select(MoodEntry).where(
                    MoodEntry.user_id == user.id, MoodEntry.created_at >= cutoff_dt
                )
            )
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
async def dashboard(user: User = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "jobs": {
            "stats": await _jobs_stats(user.id),
            "timeline": await _jobs_timeline(user.id, 14),
            "recent": await _jobs_history(user.id, 10),
        },
        "mood": {
            "stats": await _mood_stats(user.id, 7),
            "history": await _mood_history(user.id, 30, 10),
        },
    }


static_dir = Path(__file__).resolve().parents[1] / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
