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


def _patch_eden_client(task_id: str):
    """Context manager that patches EdenClient in plan.py to return a mock LLM response."""
    patcher = patch("backend.api.plan.EdenClient")
    MockEdenClient = patcher.start()
    mock_eden = MagicMock()
    MockEdenClient.return_value = mock_eden
    mock_eden._client.messages.create.return_value = _mock_plan_llm(task_id)
    return patcher, mock_eden


def test_generate_plan_returns_200(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    patcher, _ = _patch_eden_client(task["id"])
    try:
        r = client.post(f"/api/plan/generate?target_date={target_date}")
    finally:
        patcher.stop()
    assert r.status_code == 200
    data = r.json()
    assert "blocks" in data
    assert "summary" in data


def test_lock_plan(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    patcher, _ = _patch_eden_client(task["id"])
    try:
        client.post(f"/api/plan/generate?target_date={target_date}")
    finally:
        patcher.stop()
    r = client.post(f"/api/plan/lock?target_date={target_date}")
    assert r.status_code == 200
    assert "locked" in r.json()


def test_discard_plan(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    patcher, _ = _patch_eden_client(task["id"])
    try:
        client.post(f"/api/plan/generate?target_date={target_date}")
    finally:
        patcher.stop()
    r = client.delete(f"/api/plan/{target_date}")
    assert r.status_code == 200
    assert "discarded" in r.json()


def test_draft_blocks_excluded_from_schedule(client):
    task = _setup(client)
    target_date = date.today().isoformat()
    patcher, _ = _patch_eden_client(task["id"])
    try:
        client.post(f"/api/plan/generate?target_date={target_date}")
    finally:
        patcher.stop()
    # Draft blocks must NOT appear in regular schedule
    schedule = client.get("/api/schedule").json()
    assert isinstance(schedule["today"], list)
    assert isinstance(schedule["week"], list)
    for b in schedule["today"] + schedule["week"]:
        assert b.get("is_draft", False) is False


def test_generate_week_returns_seven_days(client):
    from datetime import date, timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())

    patcher, _ = _patch_eden_client("fake-task-id")
    try:
        r = client.post(f"/api/plan/generate-week?start_date={monday.isoformat()}")
    finally:
        patcher.stop()

    assert r.status_code == 200
    data = r.json()
    assert "days" in data
    assert len(data["days"]) == 7
    assert data["week_start"] == monday.isoformat()


def test_lock_week_commits_all_drafts(client):
    from datetime import date, timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())

    patcher, _ = _patch_eden_client("fake-task-id")
    try:
        client.post(f"/api/plan/generate-week?start_date={monday.isoformat()}")
    finally:
        patcher.stop()

    r = client.post(f"/api/plan/lock-week?start_date={monday.isoformat()}")
    assert r.status_code == 200
    data = r.json()
    assert "locked" in data
    assert data["locked"] >= 0
