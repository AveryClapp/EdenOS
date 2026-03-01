from backend.intelligence.prompts import SYSTEM_PROMPT, format_chat_prompt


def test_system_prompt_is_nonempty():
    assert len(SYSTEM_PROMPT) > 100


def test_system_prompt_establishes_eden_role():
    assert "Eden" in SYSTEM_PROMPT
    assert "reasoning" in SYSTEM_PROMPT.lower()


def test_system_prompt_requires_json_response():
    assert "JSON" in SYSTEM_PROMPT


def test_system_prompt_not_general_assistant():
    assert "general assistant" in SYSTEM_PROMPT.lower() or "general-purpose" in SYSTEM_PROMPT.lower()


def test_format_chat_prompt_includes_context():
    snapshot = {"goals": [], "projects": [], "tasks": {}, "alerts": []}
    result = format_chat_prompt("What should I do?", snapshot)
    assert "<context>" in result
    assert "What should I do?" in result


def test_format_chat_prompt_includes_serialized_snapshot():
    snapshot = {"goals": [{"id": "abc"}], "projects": []}
    result = format_chat_prompt("test", snapshot)
    assert "abc" in result
