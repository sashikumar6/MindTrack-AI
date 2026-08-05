"""Configurable text-to-speech with OpenAI and ElevenLabs providers."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

import metrics
from config.settings import settings

logger = logging.getLogger(__name__)

OPENAI_TTS_VOICES = (
    "alloy", "ash", "ballad", "coral", "echo",
    "sage", "shimmer", "verse", "marin", "cedar",
)

_client: Any = None
_openai: AsyncOpenAI | None = None


def _eleven_client() -> Any:
    global _client
    if _client is None:
        from elevenlabs.client import ElevenLabs

        _client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    return _client


async def _synthesize_elevenlabs(text: str) -> bytes:
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

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_run),
            timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        logger.warning("ElevenLabs synthesis timed out")
        return b""


def _openai_client() -> AsyncOpenAI:
    global _openai
    if _openai is None:
        _openai = AsyncOpenAI(
            api_key=settings.OPENAI_API_KEY,
            timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS,
            max_retries=2,
        )
    return _openai


async def _synthesize_openai(text: str, voice: str | None = None) -> bytes:
    try:
        response = await _openai_client().audio.speech.create(
            model=settings.OPENAI_TTS_MODEL,
            voice=voice or settings.OPENAI_TTS_VOICE,
            input=text,
            instructions=(
                "Speak warmly and naturally, with a calm supportive tone. "
                "Do not sound clinical, theatrical, or overly cheerful."
            ),
            response_format="mp3",
        )
        return bytes(response.content)
    except Exception as exc:
        logger.warning("OpenAI speech synthesis failed: %s", exc)
        return b""


async def synthesize(text: str, voice: str | None = None) -> bytes:
    """Return MP3 bytes from the configured provider, or empty bytes on failure.

    `voice` only affects the OpenAI provider (a per-user picker, see
    Settings) -- ElevenLabs voice selection is a fixed account voice ID
    (settings.ELEVENLABS_VOICE_ID) and is out of scope for the picker.
    """
    if not text.strip():
        return b""
    provider = settings.TTS_PROVIDER.strip().lower()
    if provider == "openai":
        started = time.monotonic()
        result = await _synthesize_openai(text, voice)
        metrics.record("tts_openai_ms", (time.monotonic() - started) * 1000)
        return result
    if provider == "elevenlabs":
        if not settings.ELEVENLABS_API_KEY:
            logger.warning("TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is empty")
            return b""
        started = time.monotonic()
        result = await _synthesize_elevenlabs(text)
        metrics.record("tts_elevenlabs_ms", (time.monotonic() - started) * 1000)
        return result
    logger.warning("Unsupported TTS_PROVIDER: %s", settings.TTS_PROVIDER)
    return b""


async def _synthesize_openai_stream(text: str, voice: str | None = None) -> AsyncIterator[bytes]:
    try:
        async with _openai_client().audio.speech.with_streaming_response.create(
            model=settings.OPENAI_TTS_MODEL,
            voice=voice or settings.OPENAI_TTS_VOICE,
            input=text,
            instructions=(
                "Speak warmly and naturally, with a calm supportive tone. "
                "Do not sound clinical, theatrical, or overly cheerful."
            ),
            response_format="mp3",
        ) as response:
            async for chunk in response.iter_bytes():
                yield chunk
    except Exception as exc:
        logger.warning("OpenAI streaming speech synthesis failed: %s", exc)


async def _synthesize_elevenlabs_stream(text: str) -> AsyncIterator[bytes]:
    # The ElevenLabs SDK's convert() call is itself a sync generator of
    # network chunks, but bridging a sync generator into this async one
    # chunk-at-a-time (without blocking the event loop) needs a thread+queue
    # relay. ElevenLabs is the secondary/optional provider here, so we take
    # the simpler route of materializing it fully in a thread first --
    # callers still get a stream of chunks, just not a progressively
    # network-fetched one.
    def _run() -> list[bytes]:
        try:
            stream = _eleven_client().text_to_speech.convert(
                voice_id=settings.ELEVENLABS_VOICE_ID,
                text=text,
                model_id="eleven_turbo_v2_5",
                output_format="mp3_44100_128",
            )
            return list(stream)
        except Exception as exc:
            logger.warning("ElevenLabs synthesis failed: %s", exc)
            return []

    for chunk in await asyncio.to_thread(_run):
        yield chunk


async def synthesize_stream(text: str, voice: str | None = None) -> AsyncIterator[bytes]:
    """Yield MP3 bytes progressively from the configured provider.

    Used for sentence-by-sentence playback (see mood_conversation's
    streaming turn processor) so the client can start playing audio before
    the whole clip has been generated. `voice` only affects the OpenAI
    provider, see synthesize().
    """
    if not text.strip():
        return
    provider = settings.TTS_PROVIDER.strip().lower()
    if provider == "openai":
        started = time.monotonic()
        first = True
        async for chunk in _synthesize_openai_stream(text, voice):
            if first:
                metrics.record("tts_openai_ttfb_ms", (time.monotonic() - started) * 1000)
                first = False
            yield chunk
        return
    if provider == "elevenlabs":
        if not settings.ELEVENLABS_API_KEY:
            logger.warning("TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is empty")
            return
        started = time.monotonic()
        first = True
        async for chunk in _synthesize_elevenlabs_stream(text):
            if first:
                metrics.record("tts_elevenlabs_ttfb_ms", (time.monotonic() - started) * 1000)
                first = False
            yield chunk
        return
    logger.warning("Unsupported TTS_PROVIDER: %s", settings.TTS_PROVIDER)
