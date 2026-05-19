"""Local Whisper transcription."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from config.settings import settings

logger = logging.getLogger(__name__)

_model: Any = None


def _load_model() -> Any:
    global _model
    if _model is None:
        import whisper as openai_whisper

        logger.info("Loading Whisper model %r…", settings.WHISPER_MODEL)
        _model = openai_whisper.load_model(settings.WHISPER_MODEL)
    return _model


async def transcribe(audio_path: Path) -> str:
    """Run Whisper on an audio file and return the cleaned transcript."""
    def _run() -> str:
        model = _load_model()
        result = model.transcribe(str(audio_path), fp16=False)
        return str(result.get("text", "")).strip()

    return await asyncio.to_thread(_run)
