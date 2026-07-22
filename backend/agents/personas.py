"""Selectable coach tone presets, injected into the conversation and coach
system prompts (see agents/mood_conversation.py and agents/mood_agent.py)."""
from __future__ import annotations

from typing import Literal, TypedDict

PersonaMode = Literal["warm", "direct", "gentle"]

DEFAULT_PERSONA: PersonaMode = "warm"


class PersonaSpec(TypedDict):
    label: str
    directive: str


PERSONAS: dict[str, PersonaSpec] = {
    "warm": {
        "label": "Warm & Kind",
        "directive": (
            "Tone: warm, kind, and encouraging. Validate feelings before "
            "offering any perspective. Sound like a supportive friend."
        ),
    },
    "direct": {
        "label": "Direct & Advisable",
        "directive": (
            "Tone: direct and practical. Keep validation brief, then focus "
            "on one concrete, actionable observation or suggestion. Sound "
            "like a straight-talking mentor, not a cheerleader."
        ),
    },
    "gentle": {
        "label": "Gentle & Reassuring",
        "directive": (
            "Tone: extra gentle, slow, and reassuring. Use soft, calming "
            "language and avoid pushing for detail. Prioritize making the "
            "user feel safe over making progress."
        ),
    },
}


def is_valid_persona(persona: str) -> bool:
    return persona in PERSONAS


def persona_directive(persona: str | None) -> str:
    """Never raises -- falls back to DEFAULT_PERSONA's directive for any
    unrecognized or missing value."""
    spec = PERSONAS.get(persona or "") or PERSONAS[DEFAULT_PERSONA]
    return spec["directive"]
