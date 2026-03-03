from unittest.mock import MagicMock, patch
from backend.intelligence.explainer import generate_schedule_explanation


def test_generate_explanation_returns_summary_and_block_reasoning():
    blocks = [
        {"task_id": "t1", "start_time": "09:00:00", "end_time": "10:00:00", "label": None},
        {"task_id": "t2", "start_time": "14:00:00", "end_time": "15:00:00", "label": None},
    ]
    task_map = {
        "t1": {"title": "Write paper", "cognitive_load": 3, "urgency": 3.5},
        "t2": {"title": "Review PR", "cognitive_load": 1, "urgency": 1.1},
    }
    mock_response = MagicMock()
    mock_response.content = [MagicMock(type="text", text='{"summary": "Deep work first.", "block_reasoning": {"t1": "High energy.", "t2": "Low load."}}')]

    with patch("backend.intelligence.explainer.anthropic.Anthropic") as MockAnth:
        MockAnth.return_value.messages.create.return_value = mock_response
        result = generate_schedule_explanation(blocks, task_map)

    assert "summary" in result
    assert "block_reasoning" in result
    assert result["summary"] == "Deep work first."
    assert result["block_reasoning"]["t1"] == "High energy."


def test_generate_explanation_handles_json_parse_error():
    blocks = [{"task_id": "t1", "start_time": "09:00:00", "end_time": "10:00:00", "label": None}]
    task_map = {"t1": {"title": "T", "cognitive_load": 2, "urgency": 1.0}}
    mock_response = MagicMock()
    mock_response.content = [MagicMock(type="text", text="not json")]

    with patch("backend.intelligence.explainer.anthropic.Anthropic") as MockAnth:
        MockAnth.return_value.messages.create.return_value = mock_response
        result = generate_schedule_explanation(blocks, task_map)

    assert result["summary"] == ""
    assert result["block_reasoning"] == {}
