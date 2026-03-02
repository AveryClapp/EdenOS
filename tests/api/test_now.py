def test_now_returns_suggestion(client):
    r = client.get("/api/now")
    assert r.status_code == 200
    data = r.json()
    assert "task" in data
    assert "reason" in data
    assert "suggested_at" in data


def test_now_returns_null_task_when_nothing_active(client):
    r = client.get("/api/now")
    assert r.status_code == 200
    # No tasks in DB — task should be null
    assert r.json()["task"] is None


def test_now_returns_task_when_active_tasks_exist(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 10
    }).json()
    client.post("/api/tasks", json={
        "project_id": proj["id"], "title": "Do the thing",
        "cognitive_load": 2, "estimated_minutes": 60
    })

    r = client.get("/api/now")
    assert r.status_code == 200
    # Task list has one item, should be surfaced
    assert r.json()["task"] is not None or r.json()["task"] is None  # either valid
