from fastapi.testclient import TestClient

from api.main import app


def test_health_endpoint():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_session_transcripts_require_login():
    # Session transcripts (mood history in general) are now gated by auth,
    # not a global DEMO_MODE flag -- an anonymous/demo caller was never
    # persisted in the first place, so there's nothing DEMO_MODE-specific
    # left to test here. See test_auth.py for per-user ownership coverage.
    client = TestClient(app)
    response = client.get("/mood/session/123")
    assert response.status_code == 401
