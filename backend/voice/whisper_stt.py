"""Speech-to-text with a cloud-first provider and optional local Whisper."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from config.settings import settings

logger = logging.getLogger(__name__)

_model: Any = None
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


def _load_model() -> Any:
    global _model
    if _model is None:
        import whisper as openai_whisper

        logger.info("Loading Whisper model %r…", settings.WHISPER_MODEL)
        _model = openai_whisper.load_model(settings.WHISPER_MODEL)
    return _model


async def _transcribe_local(audio_path: Path) -> str:
    def _run() -> str:
        model = _load_model()
        result = model.transcribe(str(audio_path), fp16=False)
        return str(result.get("text", "")).strip()

    return await asyncio.to_thread(_run)


async def _transcribe_openai(audio_path: Path) -> str:
    with audio_path.open("rb") as audio_file:
        result = await _client().audio.transcriptions.create(
            model=settings.OPENAI_TRANSCRIPTION_MODEL,
            file=audio_file,
            response_format="text",
        )
    if isinstance(result, str):
        return result.strip()
    return str(getattr(result, "text", "")).strip()


async def transcribe(audio_path: Path) -> str:
    """Transcribe an audio file using the configured provider."""
    provider = settings.STT_PROVIDER.strip().lower()
    if provider == "openai":
        return await _transcribe_openai(audio_path)
    if provider == "local":
        return await _transcribe_local(audio_path)
    raise ValueError(f"Unsupported STT_PROVIDER: {settings.STT_PROVIDER}")
