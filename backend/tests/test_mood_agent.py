from agents.mood_agent import _clamp


def test_clamp_handles_valid_and_invalid_values():
    assert _clamp(7.6) == 8
    assert _clamp(99) == 10
    assert _clamp(-4) == 1
    assert _clamp("bad") == 1
