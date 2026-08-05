from fastapi.testclient import TestClient

from api.main import app
from voice.realtime import RealtimeCallResult, build_realtime_session


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


def test_realtime_session_uses_patient_semantic_vad_and_selected_companion():
    config = build_realtime_session(
        persona="logical",
        conversation_mode="advice",
        voice="cedar",
    )
    assert config["model"]
    assert config["audio"]["input"]["turn_detection"]["type"] == "semantic_vad"
    assert config["audio"]["input"]["turn_detection"]["eagerness"] == "low"
    assert config["audio"]["input"]["turn_detection"]["create_response"] is True
    assert config["audio"]["output"]["voice"] == "cedar"
    assert "Your name is Atlas." in config["instructions"]
    assert "Do not repeat your introduction in later turns." in config["instructions"]


def test_realtime_call_proxies_sdp_without_exposing_api_key(monkeypatch):
    async def fake_create(sdp, session_config, safety_identifier):
        assert sdp == "v=0\r\n"
        assert session_config["type"] == "realtime"
        return RealtimeCallResult(200, "v=0\r\na=answer\r\n", "application/sdp")

    monkeypatch.setattr("api.main.create_realtime_call", fake_create)
    client = TestClient(app)
    response = client.post(
        "/mood/realtime/call",
        content="v=0\r\n",
        headers={"Content-Type": "application/sdp"},
    )
    assert response.status_code == 200
    assert response.text == "v=0\r\na=answer\r\n"
    assert response.headers["content-type"].startswith("application/sdp")


def test_realtime_safety_is_deterministic():
    client = TestClient(app)
    response = client.post(
        "/mood/realtime/safety",
        json={"text": "I want to kill myself"},
    )
    assert response.status_code == 200
    assert response.json() == {"safety_event": True}


def test_voice_latency_report_rejects_unknown_metric():
    client = TestClient(app)
    response = client.post("/metrics/voice-latency", json={"metric": "made_up", "ms": 10})
    assert response.status_code == 422


def test_voice_latency_report_and_snapshot_roundtrip():
    client = TestClient(app)
    response = client.post(
        "/metrics/voice-latency", json={"metric": "realtime_ttfa", "ms": 250}
    )
    assert response.status_code == 200
    snapshot = client.get("/metrics/voice-latency").json()
    assert snapshot["realtime_ttfa"]["count"] >= 1
    assert snapshot["realtime_ttfa"]["max_ms"] >= 250
