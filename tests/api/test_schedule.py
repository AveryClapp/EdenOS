from datetime import date


def _setup(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    project = client.post("/api/projects", json={
        "title": "P", "category": "engineering", "goal_id": goal["id"]
    }).json()
    task = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 2, "estimated_minutes": 60,
    }).json()
    return task


def test_get_schedule_empty(client):
    r = client.get("/api/schedule")
    assert r.status_code == 200
    data = r.json()
    assert "today" in data
    assert "week" in data
    assert isinstance(data["today"], list)
    assert isinstance(data["week"], list)


def test_run_scheduler_returns_counts(client):
    _setup(client)
    r = client.post("/api/schedule/run")
    assert r.status_code == 200
    data = r.json()
    assert "blocks_created" in data
    assert "blocks_cleared" in data
    assert data["blocks_created"] >= 0


def test_run_scheduler_creates_blocks(client):
    _setup(client)
    client.post("/api/schedule/run")
    r = client.get("/api/schedule")
    all_blocks = r.json()["week"]
    assert isinstance(all_blocks, list)


def test_override_creates_block(client):
    today = date.today().isoformat()
    r = client.post("/api/schedule/override", json={
        "date": today,
        "start_time": "09:00",
        "end_time": "10:00",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["overridden_by_user"] is True


def test_override_respects_existing_manual_blocks(client):
    """Running scheduler after override must not touch overridden blocks."""
    _setup(client)
    today = date.today().isoformat()
    override = client.post("/api/schedule/override", json={
        "date": today, "start_time": "09:00", "end_time": "10:00"
    }).json()

    client.post("/api/schedule/run")

    r = client.get("/api/schedule")
    block_ids = [b["id"] for b in r.json()["week"]]
    assert override["id"] in block_ids
