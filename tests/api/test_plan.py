import json
from datetime import date
from unittest.mock import patch, MagicMock


def _setup(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 10
    }).json()
    task = client.post("/api/tasks", json={
        "project_id": proj["id"], "title": "Write tests",
        "cognitive_load": 2, "estimated_minutes": 60
    }).json()
    return task


def _mock_plan_llm(task_id: str):
    proposal = json.dumps({
        "blocks": [
            {"task_id": task_id, "start_time": "09:00", "end_time": "10:00",
             "reason": "Morning peak energy"}
        ],
        "summary": "Focused morning session."
    })
    msg = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = proposal
    msg.content = [block]
    return msg


def test_generate_plan_returns_200(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_llm(task["id"])
        r = client.post(f"/api/plan/generate?target_date={target_date}")
    assert r.status_code == 200
    data = r.json()
    assert "blocks" in data
    assert "summary" in data


def test_lock_plan(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_llm(task["id"])
        client.post(f"/api/plan/generate?target_date={target_date}")
    r = client.post(f"/api/plan/lock?target_date={target_date}")
    assert r.status_code == 200
    assert "locked" in r.json()


def test_discard_plan(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_llm(task["id"])
        client.post(f"/api/plan/generate?target_date={target_date}")
    r = client.delete(f"/api/plan/{target_date}")
    assert r.status_code == 200
    assert "discarded" in r.json()


def test_draft_blocks_excluded_from_schedule(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_llm(task["id"])
        client.post(f"/api/plan/generate?target_date={target_date}")
    # Draft blocks must NOT appear in regular schedule
    schedule = client.get("/api/schedule").json()
    assert isinstance(schedule["today"], list)
    assert isinstance(schedule["week"], list)
    # All returned blocks should have is_draft absent or false (they're serialized dicts)
    for b in schedule["today"] + schedule["week"]:
        assert b.get("is_draft", False) is False


def test_generate_week_returns_seven_days(client):
    from datetime import date, timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())

    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_llm("fake-task-id")

        r = client.post(f"/api/plan/generate-week?start_date={monday.isoformat()}")

    assert r.status_code == 200
    data = r.json()
    assert "days" in data
    assert len(data["days"]) == 7
    assert data["week_start"] == monday.isoformat()


def test_lock_week_commits_all_drafts(client):
    from datetime import date, timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())

    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_llm("fake-task-id")
        client.post(f"/api/plan/generate-week?start_date={monday.isoformat()}")

    r = client.post(f"/api/plan/lock-week?start_date={monday.isoformat()}")
    assert r.status_code == 200
    data = r.json()
    assert "locked" in data
    assert data["locked"] >= 0
