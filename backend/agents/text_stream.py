"""Generic sentence-boundary chunking over an async stream of text deltas.

Used to turn a token-streamed LLM completion into discrete sentences so each
one can be handed to TTS as soon as it's ready, instead of waiting for the
whole response -- see mood_conversation.process_turn_streaming.
"""
from __future__ import annotations

import re
from typing import AsyncIterator

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")


async def sentence_stream(deltas: AsyncIterator[str]) -> AsyncIterator[str]:
    """Buffer raw token deltas and yield complete sentences as boundaries
    appear. Any trailing text without a terminator is flushed as a final
    sentence once the source stream ends."""
    buffer = ""
    async for delta in deltas:
        buffer += delta
        while True:
            match = _SENTENCE_END_RE.search(buffer)
            if not match:
                break
            sentence, buffer = buffer[: match.start()], buffer[match.end() :]
            sentence = sentence.strip()
            if sentence:
                yield sentence
    tail = buffer.strip()
    if tail:
        yield tail
