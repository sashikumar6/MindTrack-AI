from agents.personas import (
    CONVERSATION_MODES,
    DEFAULT_CONVERSATION_MODE,
    DEFAULT_PERSONA,
    PERSONAS,
    companion_name,
    conversation_mode_directive,
    is_valid_conversation_mode,
    is_valid_persona,
    persona_directive,
)


def test_is_valid_persona():
    assert is_valid_persona("empathetic")
    assert is_valid_persona("direct")
    assert is_valid_persona("strict")
    assert is_valid_persona("logical")
    assert not is_valid_persona("bogus")


def test_persona_directive_known_persona_matches_spec():
    assert persona_directive("direct") == PERSONAS["direct"]["directive"]


def test_persona_directive_falls_back_to_default():
    default_directive = PERSONAS[DEFAULT_PERSONA]["directive"]
    assert persona_directive(None) == default_directive
    assert persona_directive("bogus") == default_directive
    assert persona_directive("") == default_directive


def test_companion_name_tracks_persona_and_falls_back():
    assert companion_name("empathetic") == "Jeni"
    assert companion_name("logical") == "Atlas"
    assert companion_name("playful") == "Nova"
    assert companion_name("bogus") == "Jeni"


def test_conversation_modes_validate_and_fall_back():
    assert is_valid_conversation_mode("just_listen")
    assert is_valid_conversation_mode("action_plan")
    assert not is_valid_conversation_mode("diagnose")
    default_directive = CONVERSATION_MODES[DEFAULT_CONVERSATION_MODE]["directive"]
    assert conversation_mode_directive(None) == default_directive
    assert conversation_mode_directive("bogus") == default_directive
