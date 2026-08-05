"""Multi-turn conversational mood agent with memory of recent entries."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, AsyncIterator, Literal, TypedDict

from openai import AsyncOpenAI
from sqlalchemy import select

from config.settings import settings
from db.database import get_session
from db.models import ConversationTurn, MoodEntry, MoodSession
from agents.mood_agent import extract_mood, generate_coach_response, stream_coach_response
from agents.personas import (
    DEFAULT_CONVERSATION_MODE,
    DEFAULT_PERSONA,
    companion_name,
    conversation_mode_directive,
    persona_directive,
)
from agents.safety import CRISIS_RESPONSE, contains_crisis_language
from agents.text_stream import sentence_stream

logger = logging.getLogger(__name__)

MAX_TURNS = 6  # safety cap: agent must finalize by turn 6
MIN_USER_TURNS_BEFORE_FINALIZE = 2
FIRST_TURN_FOLLOW_UP = "I hear you. What part of that is staying with you most right now?"

VALID_VIBES = {"calm", "warm", "energized", "tense", "low"}
DEFAULT_VIBE = "calm"

CONVERSATION_SYSTEM_PROMPT = """You are a warm, attentive personal mental-health coach having a daily check-in with the user.

Your job each turn is to decide ONE of two actions:
  1. "ask"      — ask a single focused follow-up question to learn more about how they're really doing
  2. "finalize" — you have enough to summarize their mood; deliver a brief 2-3 sentence supportive closing

Guidelines:
- Ask follow-ups when the user's response is short, vague, surface-level, or you don't yet have a clear read on mood / energy / anxiety / what's actually going on.
- Reference recent history naturally when it helps ("you mentioned the deadline yesterday — still weighing on you?"). Do not invent history.
- Never ask more than ONE question per turn. Be specific, not generic.
- Never finalize after the first ordinary user answer. You MUST ask one focused follow-up first, even if you think you have enough context. Finalize only when you have a clear sense of how they're feeling AND what's driving it, normally after 2-3 user turns. Always finalize by turn 6.
- The closing message should be human, warm, non-clinical, and reference what they actually said. Never preachy.
- "vibe" is a quick honest read of the emotional energy in the user's LAST message (not your own reply) — recompute it fresh every turn.

Return JSON only:
{
  "action": "ask" | "finalize",
  "message": "<what you say to the user>",
  "reasoning": "<one short sentence: why this action>",
  "vibe": "calm" | "warm" | "energized" | "tense" | "low"
}
"""


class AgentDecision(TypedDict, total=False):
    action: Literal["ask", "finalize"]
    message: str
    reasoning: str
    vibe: str


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


def _recent_history(
    user_id: int | None, days: int = 14, limit: int = 7
) -> list[dict[str, Any]]:
    """Recent mood entries the agent can reference for memory.

    Anonymous/demo callers (user_id is None) always get no memory -- there is
    nothing persisted for them to recall, and nothing here should ever read
    across users.
    """
    if user_id is None:
        return []
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
    return [
        {
            "when": r.created_at.isoformat() if r.created_at else None,
            "mood": r.mood_score,
            "energy": r.energy_level,
            "anxiety": r.anxiety_level,
            "summary": r.summary,
            "keywords": [k for k in (r.keywords or "").split(",") if k],
        }
        for r in rows
    ]


def recent_history(
    user_id: int | None, days: int = 14, limit: int = 7
) -> list[dict[str, Any]]:
    """Public read-only history helper for preconfigured Realtime sessions."""
    return _recent_history(user_id, days, limit)


def _build_messages(
    history: list[dict[str, Any]],
    turns: list[dict[str, str]],
    turn_number: int,
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> list[dict[str, str]]:
    memory_block = (
        "Recent check-ins (most recent first):\n"
        + json.dumps(history, indent=2)
        if history
        else "Recent check-ins: none — this is one of their first sessions."
    )
    sys = (
        f"Your name is {companion_name(persona)}.\n\n"
        + CONVERSATION_SYSTEM_PROMPT
        + "\n\n" + persona_directive(persona)
        + "\n\n" + conversation_mode_directive(conversation_mode)
        + f"\n\nThis is user turn {turn_number} of at most {MAX_TURNS}."
        + f" {'You MUST finalize now.' if turn_number >= MAX_TURNS else ''}"
        + "\n\n" + memory_block
    )
    msgs: list[dict[str, str]] = [{"role": "system", "content": sys}]
    for t in turns:
        role = "assistant" if t["role"] == "agent" else "user"
        msgs.append({"role": role, "content": t["content"]})
    return msgs


async def _decide(
    history: list[dict[str, Any]],
    turns: list[dict[str, str]],
    turn_number: int,
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> AgentDecision:
    resp = await _client().chat.completions.create(
        model=settings.CONVERSATION_MODEL,
        response_format={"type": "json_object"},
        temperature=0.6,
        max_tokens=300,
        messages=_build_messages(history, turns, turn_number, persona, conversation_mode),
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("Conversation agent returned invalid JSON: %s", exc)
        return {
            "action": "finalize" if turn_number >= MAX_TURNS else "ask",
            "message": (
                "Thanks for checking in today."
                if turn_number >= MAX_TURNS
                else FIRST_TURN_FOLLOW_UP
            ),
            "reasoning": "json parse failure",
            "vibe": DEFAULT_VIBE,
        }

    action = data.get("action") if data.get("action") in ("ask", "finalize") else "finalize"
    message = str(data.get("message") or "").strip()
    if not message:
        message = (
            "Tell me a bit more about how today felt." if action == "ask"
            else "Thanks for sharing — talk again tomorrow."
        )
    if turn_number >= MAX_TURNS:
        action = "finalize"
    elif turn_number < MIN_USER_TURNS_BEFORE_FINALIZE and action == "finalize":
        # This is enforced in code, not only in the prompt: a model deciding
        # too early must never turn a single answer into a completed score.
        action = "ask"
        message = FIRST_TURN_FOLLOW_UP
    vibe = data.get("vibe") if data.get("vibe") in VALID_VIBES else DEFAULT_VIBE
    return {
        "action": action,
        "message": message,
        "reasoning": str(data.get("reasoning") or ""),
        "vibe": vibe,
    }


def _load_turns(session_id: int) -> list[dict[str, str]]:
    with get_session() as session:
        rows = (
            session.execute(
                select(ConversationTurn)
                .where(ConversationTurn.session_id == session_id)
                .order_by(ConversationTurn.id)
            )
            .scalars()
            .all()
        )
        return [{"role": r.role, "content": r.content} for r in rows]


def _persist_turn(session_id: int, role: str, content: str) -> None:
    with get_session() as session:
        session.add(ConversationTurn(session_id=session_id, role=role, content=content))


def _get_session_row(session_id: int) -> MoodSession | None:
    with get_session() as session:
        return session.execute(
            select(MoodSession).where(MoodSession.id == session_id)
        ).scalar_one_or_none()


def _purge_demo_session(session_id: int, entry_id: int) -> None:
    """Remove a completed public-demo conversation and its transcript."""
    with get_session() as session:
        sess = session.execute(
            select(MoodSession).where(MoodSession.id == session_id)
        ).scalar_one_or_none()
        if sess is not None:
            sess.mood_entry_id = None
            session.flush()
            session.delete(sess)
        entry = session.execute(
            select(MoodEntry).where(MoodEntry.id == entry_id)
        ).scalar_one_or_none()
        if entry is not None:
            session.delete(entry)


async def start_session(
    user_id: int | None = None,
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> dict[str, Any]:
    """Open a new conversation. Agent greets the user, optionally referencing recent history."""
    history = _recent_history(user_id)
    with get_session() as session:
        sess = MoodSession(status="active", user_id=user_id)
        session.add(sess)
        session.flush()
        session_id = sess.id

    decision = await _decide(
        history,
        turns=[],
        turn_number=0,
        persona=persona,
        conversation_mode=conversation_mode,
    )
    # The opener should always be an "ask" — coerce if model picks finalize on an empty session.
    # No user message exists yet to read a vibe from, so the opener is always "calm".
    if decision["action"] == "finalize":
        decision = {
            "action": "ask",
            "message": "Hey — how are you doing today?",
            "reasoning": "opener fallback",
            "vibe": DEFAULT_VIBE,
        }
    name = companion_name(persona)
    if name.casefold() not in decision["message"].casefold():
        decision = {**decision, "message": f"Hi, I'm {name}. {decision['message']}"}
    _persist_turn(session_id, "agent", decision["message"])
    return {
        "session_id": session_id,
        "agent_name": name,
        "agent_message": decision["message"],
        "status": "active",
        "vibe": DEFAULT_VIBE,
    }


async def finalize_realtime_session(
    turns: list[dict[str, str]],
    user_id: int | None = None,
) -> dict[str, Any]:
    """Extract and persist a completed native Realtime conversation.

    Realtime already produced the spoken companion response, so this path
    intentionally runs only mood extraction. It does not make a second coach
    or TTS call after the live conversation ends.
    """
    clean_turns = [
        {"role": turn["role"], "content": turn["content"].strip()}
        for turn in turns
        if turn.get("role") in {"user", "agent"} and turn.get("content", "").strip()
    ]
    user_text = "\n".join(
        turn["content"] for turn in clean_turns if turn["role"] == "user"
    )
    if not user_text:
        raise ValueError("No user transcript to finalize")

    crisis = contains_crisis_language(user_text)
    mood = (
        {
            "mood_score": 1,
            "energy_level": 1,
            "anxiety_level": 10,
            "keywords": ["immediate safety concern"],
            "summary": "The check-in contains language indicating a possible immediate safety concern.",
        }
        if crisis
        else await extract_mood(user_text)
    )
    agent_response = (
        CRISIS_RESPONSE
        if crisis
        else next(
            (
                turn["content"]
                for turn in reversed(clean_turns)
                if turn["role"] == "agent"
            ),
            "Realtime voice check-in completed.",
        )
    )

    entry_id = None
    session_id = None
    created_at = datetime.utcnow()
    if user_id is not None:
        with get_session() as session:
            entry = MoodEntry(
                user_id=user_id,
                raw_transcript=user_text,
                mood_score=mood["mood_score"],
                energy_level=mood["energy_level"],
                anxiety_level=mood["anxiety_level"],
                keywords=",".join(mood["keywords"]),
                summary=mood["summary"],
                agent_response=agent_response,
            )
            session.add(entry)
            session.flush()
            entry_id = entry.id
            created_at = entry.created_at

            realtime_session = MoodSession(
                user_id=user_id,
                status="completed",
                ended_at=datetime.utcnow(),
                mood_entry_id=entry_id,
            )
            session.add(realtime_session)
            session.flush()
            session_id = realtime_session.id
            session.add_all(
                ConversationTurn(
                    session_id=session_id,
                    role=turn["role"],
                    content=turn["content"],
                )
                for turn in clean_turns
            )

    return {
        "session_id": session_id,
        "status": "completed",
        "done": True,
        "safety_event": crisis,
        "mood_entry": {
            "id": entry_id,
            "created_at": created_at.isoformat() if created_at else None,
            "transcript": user_text,
            "mood_score": mood["mood_score"],
            "energy_level": mood["energy_level"],
            "anxiety_level": mood["anxiety_level"],
            "keywords": mood["keywords"],
            "summary": mood["summary"],
            "agent_response": agent_response,
        },
    }


async def process_turn(
    session_id: int,
    user_message: str,
    user_id: int | None = None,
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> dict[str, Any]:
    """User just spoke. Agent decides: ask follow-up, or finalize and extract mood."""
    sess = _get_session_row(session_id)
    if sess is None or sess.user_id != user_id:
        raise ValueError(f"Unknown session_id: {session_id}")
    if sess.status != "active":
        raise ValueError(f"Session {session_id} is already {sess.status}")

    user_message = user_message.strip()
    if not user_message:
        raise ValueError("Empty user message")

    _persist_turn(session_id, "user", user_message)

    turns = _load_turns(session_id)
    user_turn_count = sum(1 for t in turns if t["role"] == "user")
    history = _recent_history(user_id)
    crisis = contains_crisis_language(user_message)
    if crisis:
        decision: AgentDecision = {
            "action": "finalize",
            "message": CRISIS_RESPONSE,
            "reasoning": "possible immediate safety concern",
            "vibe": "tense",
        }
    else:
        decision = await _decide(
            history, turns, user_turn_count, persona, conversation_mode
        )

    if decision["action"] == "ask":
        _persist_turn(session_id, "agent", decision["message"])
        return {
            "session_id": session_id,
            "status": "active",
            "agent_message": decision["message"],
            "done": False,
        }

    # Finalize: build full transcript, extract mood, save entry, close session.
    user_text = "\n".join(t["content"] for t in turns if t["role"] == "user")
    mood = (
        {
            "mood_score": 1,
            "energy_level": 1,
            "anxiety_level": 10,
            "keywords": ["immediate safety concern"],
            "summary": "The check-in contains language indicating a possible immediate safety concern.",
        }
        if crisis
        else await extract_mood(user_text)
    )

    # Use the coach response generator for the closing audio so it stays
    # consistent with the one-shot path. Fall back to the agent's own message
    # if the coach call fails — both are valid closings.
    if crisis:
        closing = CRISIS_RESPONSE
    else:
        try:
            recent_avg = _recent_average_from_history(history)
            closing = await generate_coach_response(
                mood, recent_avg, persona, conversation_mode
            )
        except Exception as exc:
            logger.warning("Coach response failed in finalize, using agent message: %s", exc)
            closing = decision["message"]

    return _persist_finalize(session_id, user_id, user_text, mood, closing, crisis)


def _persist_finalize(
    session_id: int,
    user_id: int | None,
    user_text: str,
    mood: dict[str, Any],
    closing: str,
    crisis: bool,
) -> dict[str, Any]:
    """Shared tail of process_turn / process_turn_streaming: persist the
    closing message, write the MoodEntry, close the session, and (for
    anonymous/demo callers) purge it immediately after."""
    _persist_turn(session_id, "agent", closing)

    with get_session() as session:
        entry = MoodEntry(
            user_id=user_id,
            raw_transcript=user_text,
            mood_score=mood["mood_score"],
            energy_level=mood["energy_level"],
            anxiety_level=mood["anxiety_level"],
            keywords=",".join(mood["keywords"]),
            summary=mood["summary"],
            agent_response=closing,
        )
        session.add(entry)
        session.flush()
        entry_id = entry.id
        entry_created_at = entry.created_at

        sess_row = session.execute(
            select(MoodSession).where(MoodSession.id == session_id)
        ).scalar_one()
        sess_row.status = "completed"
        sess_row.ended_at = datetime.utcnow()
        sess_row.mood_entry_id = entry_id

    result = {
        "session_id": session_id,
        "status": "completed",
        "agent_message": closing,
        "done": True,
        "safety_event": crisis,
        "mood_entry": {
            "id": entry_id,
            "created_at": entry_created_at.isoformat() if entry_created_at else None,
            "transcript": user_text,
            "mood_score": mood["mood_score"],
            "energy_level": mood["energy_level"],
            "anxiety_level": mood["anxiety_level"],
            "keywords": mood["keywords"],
            "summary": mood["summary"],
            "agent_response": closing,
        },
    }
    if user_id is None:
        _purge_demo_session(session_id, entry_id)
    return result


async def process_turn_streaming(
    session_id: int,
    user_message: str,
    user_id: int | None = None,
    persona: str = DEFAULT_PERSONA,
    conversation_mode: str = DEFAULT_CONVERSATION_MODE,
) -> AsyncIterator[dict[str, Any]]:
    """Same turn logic as process_turn, but yields incremental events so a
    WebSocket route can forward text -- and, per sentence, synthesized audio
    -- to the client as soon as it's ready instead of waiting for the whole
    reply to finish generating.

    Yields, in order:
      {"type": "vibe", "vibe": <read on the user's last message>}  (once)
      {"type": "text_delta", "text": <sentence or short whole message>}  (1+)
      {"type": "turn_complete", ...}  -- same shape as process_turn()'s
      return value, plus "type", exactly once at the end.

    The "vibe" event is emitted immediately after the ask/finalize decision
    is made -- before any reply text or audio -- so a live UI can react to
    the conversation's emotional tone without waiting for the full session
    to finalize (mood_score/energy/anxiety are only known at finalize).
    """
    sess = _get_session_row(session_id)
    if sess is None or sess.user_id != user_id:
        raise ValueError(f"Unknown session_id: {session_id}")
    if sess.status != "active":
        raise ValueError(f"Session {session_id} is already {sess.status}")

    user_message = user_message.strip()
    if not user_message:
        raise ValueError("Empty user message")

    _persist_turn(session_id, "user", user_message)

    turns = _load_turns(session_id)
    user_turn_count = sum(1 for t in turns if t["role"] == "user")
    history = _recent_history(user_id)
    crisis = contains_crisis_language(user_message)
    if crisis:
        decision: AgentDecision = {
            "action": "finalize",
            "message": CRISIS_RESPONSE,
            "reasoning": "possible immediate safety concern",
            "vibe": "tense",
        }
    else:
        decision = await _decide(
            history, turns, user_turn_count, persona, conversation_mode
        )

    yield {"type": "vibe", "vibe": decision.get("vibe", DEFAULT_VIBE)}

    if decision["action"] == "ask":
        # Short, single-question replies by prompt design (see
        # CONVERSATION_SYSTEM_PROMPT) -- little to gain from token-streaming
        # a JSON-mode call (and JSON-mode text can't be safely sentence-split
        # mid-stream anyway), so just emit the whole thing as one delta.
        yield {"type": "text_delta", "text": decision["message"]}
        _persist_turn(session_id, "agent", decision["message"])
        yield {
            "type": "turn_complete",
            "session_id": session_id,
            "status": "active",
            "agent_message": decision["message"],
            "done": False,
        }
        return

    user_text = "\n".join(t["content"] for t in turns if t["role"] == "user")
    mood = (
        {
            "mood_score": 1,
            "energy_level": 1,
            "anxiety_level": 10,
            "keywords": ["immediate safety concern"],
            "summary": "The check-in contains language indicating a possible immediate safety concern.",
        }
        if crisis
        else await extract_mood(user_text)
    )

    if crisis:
        # Static, not model-generated -- nothing to stream token-by-token.
        yield {"type": "text_delta", "text": CRISIS_RESPONSE}
        closing = CRISIS_RESPONSE
    else:
        recent_avg = _recent_average_from_history(history)
        parts: list[str] = []
        try:
            async for sentence in sentence_stream(
                stream_coach_response(mood, recent_avg, persona, conversation_mode)
            ):
                parts.append(sentence)
                yield {"type": "text_delta", "text": sentence}
            closing = " ".join(parts).strip()
            if not closing:
                raise ValueError("streamed coach response was empty")
        except Exception as exc:
            logger.warning("Streaming coach response failed, falling back: %s", exc)
            closing = await generate_coach_response(
                mood, recent_avg, persona, conversation_mode
            )
            yield {"type": "text_delta", "text": closing}

    result = _persist_finalize(session_id, user_id, user_text, mood, closing, crisis)
    yield {"type": "turn_complete", **result}


def _recent_average_from_history(history: list[dict[str, Any]]) -> dict[str, float | None]:
    if not history:
        return {"mood": None, "energy": None, "anxiety": None}
    n = len(history)
    return {
        "mood": round(sum(h["mood"] or 0 for h in history) / n, 1),
        "energy": round(sum(h["energy"] or 0 for h in history) / n, 1),
        "anxiety": round(sum(h["anxiety"] or 0 for h in history) / n, 1),
    }


def get_session_transcript(session_id: int, user_id: int | None) -> dict[str, Any] | None:
    sess = _get_session_row(session_id)
    if sess is None or sess.user_id != user_id:
        return None
    turns = _load_turns(session_id)
    return {
        "session_id": session_id,
        "status": sess.status,
        "started_at": sess.started_at.isoformat() if sess.started_at else None,
        "ended_at": sess.ended_at.isoformat() if sess.ended_at else None,
        "mood_entry_id": sess.mood_entry_id,
        "turns": turns,
    }


def list_sessions(
    user_id: int, limit: int = 30, before_id: int | None = None
) -> list[dict[str, Any]]:
    """Past completed check-ins for the History page, newest first."""
    with get_session() as session:
        query = (
            select(MoodSession)
            .where(MoodSession.user_id == user_id, MoodSession.status == "completed")
            .order_by(MoodSession.id.desc())
        )
        if before_id is not None:
            query = query.where(MoodSession.id < before_id)
        rows = session.execute(query.limit(limit)).scalars().all()

        entry_ids = [r.mood_entry_id for r in rows if r.mood_entry_id]
        entries_by_id: dict[int, MoodEntry] = {}
        if entry_ids:
            entries = (
                session.execute(select(MoodEntry).where(MoodEntry.id.in_(entry_ids)))
                .scalars()
                .all()
            )
            entries_by_id = {e.id: e for e in entries}

        out: list[dict[str, Any]] = []
        for r in rows:
            entry = entries_by_id.get(r.mood_entry_id) if r.mood_entry_id else None
            out.append(
                {
                    "session_id": r.id,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "ended_at": r.ended_at.isoformat() if r.ended_at else None,
                    "status": r.status,
                    "mood_entry": (
                        {
                            "id": entry.id,
                            "mood_score": entry.mood_score,
                            "energy_level": entry.energy_level,
                            "anxiety_level": entry.anxiety_level,
                            "summary": entry.summary,
                            "keywords": [k for k in (entry.keywords or "").split(",") if k],
                        }
                        if entry
                        else None
                    ),
                }
            )
        return out
