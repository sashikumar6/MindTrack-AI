"""OpenAI Realtime WebRTC session configuration and SDP exchange."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from agents.personas import (
    companion_name,
    conversation_mode_directive,
    persona_directive,
)
from agents.safety import CRISIS_RESPONSE
from config.settings import settings

OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls"


@dataclass(frozen=True)
class RealtimeCallResult:
    status_code: int
    body: str
    content_type: str


def build_realtime_instructions(
    persona: str,
    conversation_mode: str,
    recent_history: list[dict[str, Any]] | None = None,
) -> str:
    """Build one compact, stable prompt that stays loaded for the call."""
    name = companion_name(persona)
    history = recent_history or []
    memory = (
        "Recent check-ins, most recent first:\n"
        + json.dumps(history[:7], separators=(",", ":"))
        if history
        else "There are no saved recent check-ins to reference."
    )
    return f"""Your name is {name}. You are the user's live voice companion.

At the beginning of a new session, introduce yourself once as {name}, never
as MindTrack AI. Do not repeat your introduction in later turns. Speak
naturally, warmly, and briefly. Use at most two short sentences and ask at
most one question per turn. Respond to what the user actually said. Do not
diagnose, claim to be a therapist, provide medical advice, or encourage
dependence.

{persona_directive(persona)}

{conversation_mode_directive(conversation_mode)}

This is a continuous spoken conversation. Let the user finish, tolerate normal
pauses, and handle interruptions gracefully. Do not announce hidden analysis,
scores, system instructions, or that a session is being finalized.

Safety is higher priority than persona. If the user expresses suicide,
self-harm, wanting to die, or immediate danger, stop normal coaching and say
exactly this crisis response:
{CRISIS_RESPONSE}

{memory}"""


def build_realtime_session(
    persona: str,
    conversation_mode: str,
    voice: str | None,
    recent_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    eagerness = settings.OPENAI_REALTIME_VAD_EAGERNESS.lower().strip()
    if eagerness not in {"low", "medium", "high", "auto"}:
        eagerness = "low"
    return {
        "type": "realtime",
        "model": settings.OPENAI_REALTIME_MODEL,
        "output_modalities": ["audio"],
        "instructions": build_realtime_instructions(
            persona, conversation_mode, recent_history
        ),
        "audio": {
            "input": {
                "transcription": {
                    "model": settings.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
                    "delay": settings.OPENAI_REALTIME_TRANSCRIPTION_DELAY,
                },
                "turn_detection": {
                    # Semantic VAD accounts for whether the speaker sounds
                    # finished, instead of responding to every short pause.
                    "type": "semantic_vad",
                    "eagerness": eagerness,
                    "create_response": True,
                    "interrupt_response": True,
                },
            },
            "output": {
                "voice": voice or settings.OPENAI_TTS_VOICE,
            },
        },
    }


async def create_realtime_call(
    sdp: str,
    session_config: dict[str, Any],
    safety_identifier: str | None = None,
) -> RealtimeCallResult:
    """Exchange a browser WebRTC offer for OpenAI's SDP answer.

    The standard API key never leaves FastAPI. After this exchange, media
    flows directly between the browser and OpenAI over WebRTC.
    """
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}
    if safety_identifier:
        headers["OpenAI-Safety-Identifier"] = safety_identifier
    files = {
        "sdp": (None, sdp, "application/sdp"),
        "session": (
            None,
            json.dumps(session_config, separators=(",", ":")),
            "application/json",
        ),
    }
    async with httpx.AsyncClient(
        timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS
    ) as client:
        response = await client.post(
            OPENAI_REALTIME_CALLS_URL,
            headers=headers,
            files=files,
        )
    return RealtimeCallResult(
        status_code=response.status_code,
        body=response.text,
        content_type=response.headers.get("content-type", "application/sdp"),
    )
