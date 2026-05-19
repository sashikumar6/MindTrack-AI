"""ElevenLabs text-to-speech."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from config.settings import settings

logger = logging.getLogger(__name__)

_client: Any = None


def _eleven_client() -> Any:
    global _client
    if _client is None:
        from elevenlabs.client import ElevenLabs

        _client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    return _client


async def synthesize(text: str) -> bytes:
    """Return MP3 bytes from ElevenLabs. Returns empty bytes on failure (logged)."""
    if not text.strip():
        return b""

    def _run() -> bytes:
        try:
            stream = _eleven_client().text_to_speech.convert(
                voice_id=settings.ELEVENLABS_VOICE_ID,
                text=text,
                model_id="eleven_turbo_v2_5",
                output_format="mp3_44100_128",
            )
            return b"".join(stream)
        except Exception as exc:
            logger.warning("ElevenLabs synthesis failed: %s", exc)
            return b""

    return await asyncio.to_thread(_run)
