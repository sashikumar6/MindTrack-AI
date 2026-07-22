import asyncio

from config.settings import settings
from voice import elevenlabs_tts


def test_openai_tts_provider_routing(monkeypatch):
    async def fake_openai(text: str, voice: str | None = None) -> bytes:
        return f"audio:{text}".encode()

    monkeypatch.setattr(settings, "TTS_PROVIDER", "openai")
    monkeypatch.setattr(elevenlabs_tts, "_synthesize_openai", fake_openai)
    assert asyncio.run(elevenlabs_tts.synthesize("hello")) == b"audio:hello"


def test_empty_text_skips_provider(monkeypatch):
    monkeypatch.setattr(settings, "TTS_PROVIDER", "unsupported")
    assert asyncio.run(elevenlabs_tts.synthesize("  ")) == b""


def test_synthesize_threads_voice_to_openai_call(monkeypatch):
    received = {}

    async def fake_openai(text: str, voice: str | None = None) -> bytes:
        received["voice"] = voice
        return b"audio"

    monkeypatch.setattr(settings, "TTS_PROVIDER", "openai")
    monkeypatch.setattr(elevenlabs_tts, "_synthesize_openai", fake_openai)

    asyncio.run(elevenlabs_tts.synthesize("hi", voice="ash"))
    assert received["voice"] == "ash"

    asyncio.run(elevenlabs_tts.synthesize("hi"))
    assert received["voice"] is None
