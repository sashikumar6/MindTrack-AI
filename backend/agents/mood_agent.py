"""Whisper + fine-tuned GPT-4o-mini mood extractor + ElevenLabs response."""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta
from typing import Any, AsyncIterator, TypedDict

from openai import AsyncOpenAI
from sqlalchemy import select

from config.settings import settings
from db.database import get_session
from db.models import MoodEntry
from agents.personas import (
    DEFAULT_CONVERSATION_MODE,
    DEFAULT_PERSONA,
    companion_name,
    conversation_mode_directive,
    persona_directive,
)
from agents.safety import CRISIS_RESPONSE, contains_crisis_language
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
    "daily voice check-in. This is a non-clinical wellness score, not a diagnosis. "
    "Use the full scale consistently: 1 means extremely low/calm/exhausted, 5 means "
    "ordinary or neutral, and 10 means exceptionally positive/energized/intensely "
    "anxious. Score only evidence present in the transcript. Return JSON only, "
    "nothing else.\n"
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
        _openai = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS,
            max_retries=2,
        )
    return _openai


def _extractor_model() -> str:
    return settings.OPENAI_FINETUNED_MODEL or settings.MOOD_EXTRACTOR_MODEL


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


def _recent_average(user_id: int | None, days: int = 3) -> dict[str, float | None]:
    if user_id is None:
        return {"mood": None, "energy": None, "anxiety": None}
    cutoff = datetime.utcnow() - timedelta(days=days)
    with get_session() as session:
        rows = (
            session.execute(
                select(
                    MoodEntry.mood_score,
                    MoodEntry.energy_level,
                    MoodEntry.anxiety_level,
                ).where(MoodEntry.user_id == user_id, MoodEntry.created_at >= cutoff)
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


async def generate_coach_response(
    mood: MoodData,
    recent_avg: dict[str, float | None],
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> str:
    resp = await _client().chat.completions.create(
        model=settings.COACH_MODEL,
        temperature=0.7,
        max_tokens=200,
        messages=_coach_messages(mood, recent_avg, persona, conversation_mode),
    )
    return (resp.choices[0].message.content or "").strip()


def _coach_messages(
    mood: MoodData,
    recent_avg: dict[str, float | None],
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> list[dict[str, str]]:
    user_payload = {
        "current_entry": {
            "mood_score": mood["mood_score"],
            "energy_level": mood["energy_level"],
            "anxiety_level": mood["anxiety_level"],
            "summary": mood["summary"],
        },
        "last_3_days_average": recent_avg,
    }
    sys = (
        f"Your name is {companion_name(persona)}.\n\n"
        + COACH_SYSTEM_PROMPT
        + "\n\n" + persona_directive(persona)
        + "\n\n" + conversation_mode_directive(conversation_mode)
    )
    return [
        {"role": "system", "content": sys},
        {"role": "user", "content": json.dumps(user_payload)},
    ]


async def stream_coach_response(
    mood: MoodData,
    recent_avg: dict[str, float | None],
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> AsyncIterator[str]:
    """Token-stream the same coach response as generate_coach_response, for
    low-latency sentence-chunked TTS playback (see agents.text_stream and
    mood_conversation.process_turn_streaming). This is plain prose -- no
    response_format -- so unlike the conversation agent's JSON-mode decide
    call, it's safe to sentence-split as it streams."""
    stream = await _client().chat.completions.create(
        model=settings.COACH_MODEL,
        temperature=0.7,
        max_tokens=200,
        messages=_coach_messages(mood, recent_avg, persona, conversation_mode),
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


async def run_mood_pipeline(
    transcript: str,
    user_id: int | None = None,
    persona: str = DEFAULT_PERSONA,
    voice: str | None = None,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> dict[str, Any]:
    """Run the one-shot (non-conversational) check-in pipeline.

    `user_id` is None for anonymous/demo callers: the entry is never
    persisted and no cross-session memory is used, matching the public
    demo's ephemeral/privacy-preserving behavior. Logged-in users always get
    persistent history regardless of the DEMO_MODE setting.
    """
    transcript = transcript.strip()
    if not transcript:
        raise ValueError("Empty transcript")

    crisis = contains_crisis_language(transcript)
    mood = (
        {
            "mood_score": 1,
            "energy_level": 1,
            "anxiety_level": 10,
            "keywords": ["immediate safety concern"],
            "summary": "The check-in contains language indicating a possible immediate safety concern.",
        }
        if crisis
        else await extract_mood(transcript)
    )
    recent = _recent_average(user_id)
    response_text = (
        CRISIS_RESPONSE
        if crisis
        else await generate_coach_response(mood, recent, persona, conversation_mode)
    )
    audio_bytes = await synthesize(response_text, voice=voice)

    entry_id = None
    created_at = datetime.utcnow()
    if user_id is not None:
        with get_session() as session:
            entry = MoodEntry(
                user_id=user_id,
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
        "safety_event": crisis,
    }
