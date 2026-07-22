import asyncio
import json

from agents import mood_conversation
from db.database import get_session
from db.models import MoodSession


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, content):
        self._content = content

    async def create(self, **kwargs):
        return _FakeResponse(self._content)


class _FakeChat:
    def __init__(self, content):
        self.completions = _FakeCompletions(content)


class _FakeClient:
    def __init__(self, content):
        self.chat = _FakeChat(content)


def _make_session(user_id=None) -> int:
    with get_session() as session:
        sess = MoodSession(status="active", user_id=user_id)
        session.add(sess)
        session.flush()
        return sess.id


def test_decide_returns_valid_vibe(monkeypatch):
    payload = json.dumps(
        {
            "action": "ask",
            "message": "How are you feeling?",
            "reasoning": "need more detail",
            "vibe": "tense",
        }
    )
    monkeypatch.setattr(mood_conversation, "_client", lambda: _FakeClient(payload))
    decision = asyncio.run(mood_conversation._decide([], [], 1))
    assert decision["vibe"] == "tense"


def test_decide_falls_back_to_calm_on_missing_vibe(monkeypatch):
    payload = json.dumps(
        {"action": "ask", "message": "How are you feeling?", "reasoning": "need more detail"}
    )
    monkeypatch.setattr(mood_conversation, "_client", lambda: _FakeClient(payload))
    decision = asyncio.run(mood_conversation._decide([], [], 1))
    assert decision["vibe"] == "calm"


def test_decide_falls_back_to_calm_on_invalid_vibe(monkeypatch):
    payload = json.dumps(
        {
            "action": "ask",
            "message": "How are you feeling?",
            "reasoning": "need more detail",
            "vibe": "not-a-real-vibe",
        }
    )
    monkeypatch.setattr(mood_conversation, "_client", lambda: _FakeClient(payload))
    decision = asyncio.run(mood_conversation._decide([], [], 1))
    assert decision["vibe"] == "calm"


def test_process_turn_streaming_emits_vibe_before_text_delta(monkeypatch):
    session_id = _make_session(user_id=None)

    async def fake_decide(history, turns, turn_number, persona="warm"):
        return {
            "action": "ask",
            "message": "Tell me more.",
            "reasoning": "test",
            "vibe": "tense",
        }

    monkeypatch.setattr(mood_conversation, "_decide", fake_decide)

    async def collect():
        events = []
        async for event in mood_conversation.process_turn_streaming(
            session_id, "I'm really overwhelmed today", None
        ):
            events.append(event)
        return events

    events = asyncio.run(collect())
    types = [e["type"] for e in events]
    assert types[0] == "vibe"
    assert events[0]["vibe"] == "tense"
    assert "text_delta" in types
    assert types.index("vibe") < types.index("text_delta")


def test_process_turn_streaming_crisis_emits_tense_vibe():
    session_id = _make_session(user_id=None)

    async def collect():
        events = []
        async for event in mood_conversation.process_turn_streaming(
            session_id, "I want to kill myself", None
        ):
            events.append(event)
        return events

    events = asyncio.run(collect())
    assert events[0]["type"] == "vibe"
    assert events[0]["vibe"] == "tense"
