from fastapi.testclient import TestClient

from api.main import app
from auth.crypto import decrypt, encrypt
from auth.deps import get_current_user, get_current_user_optional
from config.settings import settings
from db.database import get_session
from db.models import JobMetric, MoodEntry, MoodSession, User


def _make_user(email: str) -> User:
    with get_session() as session:
        user = User(google_sub=f"sub-{email}", email=email, name=email)
        session.add(user)
        session.flush()
        session.expunge(user)
        return user


def test_token_encryption_roundtrip():
    secret = "ya29.some-fake-google-access-token"
    token = encrypt(secret)
    assert token != secret.encode()
    assert decrypt(token) == secret


def test_protected_job_and_dashboard_endpoints_require_login():
    client = TestClient(app)
    for path in ("/jobs/history", "/jobs/stats", "/jobs/timeline", "/dashboard"):
        response = client.get(path)
        assert response.status_code == 401, path


def test_mood_history_isolated_between_users():
    user_a = _make_user("mood-a@example.com")
    user_b = _make_user("mood-b@example.com")
    with get_session() as session:
        session.add(
            MoodEntry(
                user_id=user_a.id,
                raw_transcript="a's entry",
                mood_score=5,
                energy_level=5,
                anxiety_level=5,
            )
        )
        session.add(
            MoodEntry(
                user_id=user_b.id,
                raw_transcript="b's entry",
                mood_score=5,
                energy_level=5,
                anxiety_level=5,
            )
        )

    client = TestClient(app)
    app.dependency_overrides[get_current_user_optional] = lambda: user_a
    try:
        response = client.get("/mood/history")
        assert response.status_code == 200
        assert [row["transcript"] for row in response.json()] == ["a's entry"]
    finally:
        app.dependency_overrides.pop(get_current_user_optional, None)


def test_mood_history_anonymous_returns_empty():
    client = TestClient(app)
    response = client.get("/mood/history")
    assert response.status_code == 200
    assert response.json() == []


def test_jobs_isolated_between_users_including_same_email_id():
    user_a = _make_user("job-a@example.com")
    user_b = _make_user("job-b@example.com")
    with get_session() as session:
        # Same Gmail message id under two different users must not collide --
        # uniqueness is scoped to (user_id, email_id), not email_id alone.
        session.add(
            JobMetric(user_id=user_a.id, email_id="msg-1", company="A Co", status="applied")
        )
        session.add(
            JobMetric(user_id=user_b.id, email_id="msg-1", company="B Co", status="applied")
        )

    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user_a
    try:
        response = client.get("/jobs/history")
        assert response.status_code == 200
        assert [row["company"] for row in response.json()] == ["A Co"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_session_transcript_ownership_enforced():
    user_a = _make_user("owner@example.com")
    user_b = _make_user("intruder@example.com")

    with get_session() as session:
        sess = MoodSession(status="completed", user_id=user_a.id)
        session.add(sess)
        session.flush()
        session_id = sess.id

    client = TestClient(app)

    app.dependency_overrides[get_current_user] = lambda: user_b
    try:
        response = client.get(f"/mood/session/{session_id}")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: user_a
    try:
        response = client.get(f"/mood/session/{session_id}")
        assert response.status_code == 200
        assert response.json()["session_id"] == session_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_me_includes_companion_preference_defaults():
    user = _make_user("prefs-defaults@example.com")
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.get("/auth/me")
        assert response.status_code == 200
        body = response.json()
        assert body["persona_mode"] == "empathetic"
        assert body["conversation_mode"] == "just_listen"
        assert body["tts_voice"] == "marin"
        assert body["tts_provider"] == settings.TTS_PROVIDER
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_patch_me_requires_login():
    client = TestClient(app)
    response = client.patch("/auth/me", json={"persona_mode": "direct"})
    assert response.status_code == 401


def test_patch_me_updates_companion_preferences():
    user = _make_user("prefs-update@example.com")
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.patch(
            "/auth/me",
            json={
                "persona_mode": "direct",
                "conversation_mode": "action_plan",
                "tts_voice": "coral",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["persona_mode"] == "direct"
        assert body["conversation_mode"] == "action_plan"
        assert body["tts_voice"] == "coral"

        with get_session() as session:
            row = session.get(User, user.id)
            assert row.persona_mode == "direct"
            assert row.conversation_mode == "action_plan"
            assert row.tts_voice == "coral"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_patch_me_rejects_invalid_persona():
    user = _make_user("prefs-bad-persona@example.com")
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.patch("/auth/me", json={"persona_mode": "bogus"})
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_patch_me_rejects_invalid_voice():
    user = _make_user("prefs-bad-voice@example.com")
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.patch("/auth/me", json={"tts_voice": "bogus"})
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_patch_me_rejects_invalid_conversation_mode():
    user = _make_user("prefs-bad-mode@example.com")
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.patch("/auth/me", json={"conversation_mode": "diagnose"})
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_patch_me_rejects_empty_body():
    user = _make_user("prefs-empty@example.com")
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = client.patch("/auth/me", json={})
        assert response.status_code == 400
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_voice_preview_returns_audio_for_valid_voice(monkeypatch):
    client = TestClient(app)

    async def fake_synthesize(text, voice=None):
        assert "I'm Ava" in text
        assert "MindTrack voice preview" not in text
        assert voice == "marin"
        return b"fake-mp3"

    monkeypatch.setattr("api.main.synthesize", fake_synthesize)
    response = client.post("/mood/voice-preview", json={"voice": "marin"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"fake-mp3"


def test_voice_preview_rejects_unknown_voice():
    client = TestClient(app)
    response = client.post("/mood/voice-preview", json={"voice": "unknown"})
    assert response.status_code == 422
