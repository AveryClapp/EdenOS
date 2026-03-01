import uuid
import json
from datetime import date, datetime
from unittest.mock import MagicMock, patch
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task


def _setup_db(db):
    goal = Goal(
        id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
        target_date=date(2027, 1, 1), status="active",
    )
    project = Project(
        id=str(uuid.uuid4()), title="P", category="engineering",
        goal_id=goal.id, status="active",
    )
    task = Task(
        id=str(uuid.uuid4()), title="T", project_id=project.id,
        cognitive_load=2, estimated_minutes=60, status="backlog", source="manual",
    )
    db.add_all([goal, project, task])
    db.commit()


def _mock_response(text: str):
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    return msg


def test_chat_calls_anthropic_api(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "Because X", "content": "Do task T."})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        result = client.chat("What should I do?", db)

        assert mock_client.messages.create.called


def test_chat_injects_full_context(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "r", "content": "c"})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        client.chat("test", db)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        user_content = call_kwargs["messages"][0]["content"]
        assert "<context>" in user_content
        assert "goals" in user_content


def test_chat_uses_system_prompt(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "r", "content": "c"})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        client.chat("test", db)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert "system" in call_kwargs
        assert "Eden" in call_kwargs["system"]


def test_chat_returns_parsed_response(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "Task X is urgent.", "content": "Work on X now."})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        result = client.chat("What next?", db)

        assert result["reasoning"] == "Task X is urgent."
        assert result["content"] == "Work on X now."


def test_chat_handles_non_json_response(db):
    _setup_db(db)

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response("plain text response")

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        result = client.chat("test", db)

        assert "content" in result
        assert result["content"] == "plain text response"
        assert "reasoning" in result


def test_get_alerts_does_not_call_llm(db):
    _setup_db(db)

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        alerts = client.get_alerts(db)

        assert isinstance(alerts, list)
        assert not mock_client.messages.create.called
