from agents.safety import contains_crisis_language


def test_detects_direct_crisis_language():
    assert contains_crisis_language("I don't want to live anymore")
    assert contains_crisis_language("I've been thinking about self-harm")
    assert contains_crisis_language("I might hurt myself tonight")


def test_does_not_flag_ordinary_distress():
    assert not contains_crisis_language("Work is exhausting and I need a break")
    assert not contains_crisis_language("I feel anxious about tomorrow's interview")
