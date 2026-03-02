import json
from unittest.mock import patch, MagicMock
from backend.intelligence.memory import extract_memories_from_conversation


def _mock_anthropic_response(text: str):
    msg = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = text
    msg.content = [block]
    return msg


def test_extract_memories_returns_list(db):
    reply = json.dumps([
        {"category": "preference", "content": "prefers morning deep work", "confidence": 0.9},
    ])
    with patch("backend.intelligence.memory.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response(reply)
        result = extract_memories_from_conversation(
            user_message="I work best in the morning for deep focus tasks",
            assistant_response="Got it, I'll prioritize deep work before noon.",
            db=db,
        )
    assert isinstance(result, list)
    assert len(result) == 1
    assert result[0].category == "preference"


def test_extract_memories_handles_empty_list(db):
    reply = json.dumps([])
    with patch("backend.intelligence.memory.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response(reply)
        result = extract_memories_from_conversation("hello", "hi", db=db)
    assert result == []


def test_extract_memories_handles_invalid_json(db):
    with patch("backend.intelligence.memory.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response("not json")
        result = extract_memories_from_conversation("test", "test", db=db)
    assert result == []
