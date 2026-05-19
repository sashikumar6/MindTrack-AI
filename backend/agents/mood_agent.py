"""Whisper + fine-tuned GPT-4o-mini mood extractor + ElevenLabs response."""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta
from typing import Any, TypedDict

from openai import AsyncOpenAI
from sqlalchemy import select

from config.settings import settings
from db.database import get_session
from db.models import MoodEntry
from voice.elevenlabs_tts import synthesize

logger = logging.getLogger(__name__)


class MoodData(TypedDict):
    mood_score: int
    energy_level: int
    anxiety_level: int
    keywords: list[str]
    summary: str


EXTRACTOR_SYSTEM_PROMPT = (
    "You are a mental health data extractor. Extract structured data from this "
    "daily voice check-in. Return JSON only, nothing else.\n"
    "{\n"
    '  "mood_score": 1-10,\n'
    '  "energy_level": 1-10,\n'
    '  "anxiety_level": 1-10,\n'
    '  "keywords": ["word1", "word2"],\n'
    '  "summary": "one sentence summary"\n'
    "}"
)

COACH_SYSTEM_PROMPT = (
    "You are a warm, non-clinical personal coach. The user just logged their "
    "daily check-in. Based on their mood data and recent history (provided), "
    "give a brief 2-3 sentence supportive response. Be human, not robotic. "
    "Reference their actual scores naturally. Never be preachy or over-positive."
)

_openai: AsyncOpenAI | None = None


def _client() -> AsyncOpenAI:
    global _openai
    if _openai is None:
        _openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai


def _extractor_model() -> str:
    return settings.OPENAI_FINETUNED_MODEL or "gpt-4o"


def _clamp(value: Any, lo: int = 1, hi: int = 10) -> int:
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        n = lo
    return max(lo, min(hi, n))


async def extract_mood(transcript: str) -> MoodData:
    """Extract structured mood data from a transcript."""
    resp = await _client().chat.completions.create(
        model=_extractor_model(),
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": EXTRACTOR_SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("Mood extractor returned invalid JSON: %s", exc)
        raise ValueError("Mood extractor returned invalid JSON") from exc

    keywords = data.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [k.strip() for k in keywords.split(",") if k.strip()]
    elif not isinstance(keywords, list):
        keywords = []

    return {
        "mood_score": _clamp(data.get("mood_score")),
        "energy_level": _clamp(data.get("energy_level")),
        "anxiety_level": _clamp(data.get("anxiety_level")),
        "keywords": [str(k) for k in keywords][:10],
        "summary": str(data.get("summary") or "").strip()[:500],
    }


def _recent_average(days: int = 3) -> dict[str, float | None]:
    cutoff = datetime.utcnow() - timedelta(days=days)
    with get_session() as session:
        rows = (
            session.execute(
                select(
                    MoodEntry.mood_score,
                    MoodEntry.energy_level,
                    MoodEntry.anxiety_level,
                ).where(MoodEntry.created_at >= cutoff)
            )
            .all()
        )
    if not rows:
        return {"mood": None, "energy": None, "anxiety": None}
    n = len(rows)
    return {
        "mood": round(sum((r[0] or 0) for r in rows) / n, 1),
        "energy": round(sum((r[1] or 0) for r in rows) / n, 1),
        "anxiety": round(sum((r[2] or 0) for r in rows) / n, 1),
    }


async def generate_coach_response(mood: MoodData, recent_avg: dict[str, float | None]) -> str:
    user_payload = {
        "current_entry": {
            "mood_score": mood["mood_score"],
            "energy_level": mood["energy_level"],
            "anxiety_level": mood["anxiety_level"],
            "summary": mood["summary"],
        },
        "last_3_days_average": recent_avg,
    }
    resp = await _client().chat.completions.create(
        model="gpt-4o",
        temperature=0.7,
        max_tokens=200,
        messages=[
            {"role": "system", "content": COACH_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload)},
        ],
    )
    return (resp.choices[0].message.content or "").strip()


async def run_mood_pipeline(transcript: str) -> dict[str, Any]:
    transcript = transcript.strip()
    if not transcript:
        raise ValueError("Empty transcript")

    mood = await extract_mood(transcript)
    recent = _recent_average()
    response_text = await generate_coach_response(mood, recent)
    audio_bytes = await synthesize(response_text)

    with get_session() as session:
        entry = MoodEntry(
            raw_transcript=transcript,
            mood_score=mood["mood_score"],
            energy_level=mood["energy_level"],
            anxiety_level=mood["anxiety_level"],
            keywords=",".join(mood["keywords"]),
            summary=mood["summary"],
            agent_response=response_text,
        )
        session.add(entry)
        session.flush()
        entry_id = entry.id
        created_at = entry.created_at

    return {
        "id": entry_id,
        "created_at": created_at.isoformat() if created_at else None,
        "transcript": transcript,
        "mood_score": mood["mood_score"],
        "energy_level": mood["energy_level"],
        "anxiety_level": mood["anxiety_level"],
        "keywords": mood["keywords"],
        "summary": mood["summary"],
        "agent_response": response_text,
        "audio_b64": base64.b64encode(audio_bytes).decode("ascii") if audio_bytes else "",
        "recent_average": recent,
    }
