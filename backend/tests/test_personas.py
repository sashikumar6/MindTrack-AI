from agents.personas import DEFAULT_PERSONA, PERSONAS, is_valid_persona, persona_directive


def test_is_valid_persona():
    assert is_valid_persona("warm")
    assert is_valid_persona("direct")
    assert is_valid_persona("gentle")
    assert not is_valid_persona("bogus")


def test_persona_directive_known_persona_matches_spec():
    assert persona_directive("direct") == PERSONAS["direct"]["directive"]


def test_persona_directive_falls_back_to_default():
    default_directive = PERSONAS[DEFAULT_PERSONA]["directive"]
    assert persona_directive(None) == default_directive
    assert persona_directive("bogus") == default_directive
    assert persona_directive("") == default_directive
