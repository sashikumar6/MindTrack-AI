"""Deterministic safety handling for a non-clinical wellness demo."""
from __future__ import annotations

import re

CRISIS_PATTERNS = (
    r"\bkill myself\b",
    r"\bend my life\b",
    r"\bdon'?t want to (?:be alive|live)\b",
    r"\bwant to die\b",
    r"\bsuicid(?:e|al)\b",
    r"\bself[- ]?harm\b",
    r"\bhurt myself\b",
    r"\boverdose\b",
)

CRISIS_RESPONSE = (
    "I’m really sorry you’re going through this. I’m not equipped to provide "
    "crisis care. If you may act on these thoughts or are in immediate danger, "
    "call 911 now. In the U.S., call or text 988 for free, confidential support "
    "24/7. Please reach out to someone you trust and stay with them if you can."
)


def contains_crisis_language(text: str) -> bool:
    normalized = " ".join(text.lower().split())
    return any(re.search(pattern, normalized) for pattern in CRISIS_PATTERNS)
