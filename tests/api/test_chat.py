import json
from unittest.mock import MagicMock, patch


def _mock_llm(text: str):
    msg = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = text
    msg.content = [block]
    return msg


def test_get_alerts_empty(client):
    r = client.get("/api/chat/alerts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_chat_returns_content_and_reasoning(client):
    reply = json.dumps({"reasoning": "Task X has urgency 2.1.", "content": "Work on X."})
    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_llm(reply)

        r = client.post("/api/chat", json={"message": "What should I do?"})
        assert r.status_code == 200
        data = r.json()
        assert data["content"] == "Work on X."
        assert data["reasoning"] == "Task X has urgency 2.1."


def test_chat_handles_plain_text_response(client):
    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_llm("Just do the thing.")

        r = client.post("/api/chat", json={"message": "help"})
        assert r.status_code == 200
        data = r.json()
        assert "content" in data
        assert "reasoning" in data
