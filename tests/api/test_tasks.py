import uuid


def _setup(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    project = client.post("/api/projects", json={
        "title": "P", "category": "engineering", "goal_id": goal["id"]
    }).json()
    return project


def test_list_tasks_empty(client):
    r = client.get("/api/tasks")
    assert r.status_code == 200
    assert r.json() == []


def test_create_task(client):
    project = _setup(client)
    r = client.post("/api/tasks", json={
        "project_id": project["id"],
        "title": "Write tests",
        "cognitive_load": 2,
        "estimated_minutes": 90,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Write tests"
    assert data["status"] == "backlog"
    assert data["source"] == "manual"


def test_get_task(client):
    project = _setup(client)
    created = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 1, "estimated_minutes": 30,
    }).json()
    r = client.get(f"/api/tasks/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_task_not_found(client):
    r = client.get(f"/api/tasks/{uuid.uuid4()}")
    assert r.status_code == 404


def test_update_task_status(client):
    project = _setup(client)
    created = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 2, "estimated_minutes": 60,
    }).json()
    r = client.patch(f"/api/tasks/{created['id']}", json={"status": "in_progress"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_progress"


def test_complete_task_sets_done_and_creates_learning_record(client):
    project = _setup(client)
    created = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 2, "estimated_minutes": 60,
    }).json()
    r = client.post(f"/api/tasks/{created['id']}/complete", json={
        "actual_minutes": 75,
        "completion_quality": 4,
        "energy_level_at_start": 3,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "done"
    assert data["actual_minutes"] == 75


def test_list_tasks_filter_by_project(client):
    project = _setup(client)
    client.post("/api/tasks", json={
        "project_id": project["id"], "title": "In project",
        "cognitive_load": 1, "estimated_minutes": 30,
    })
    r = client.get(f"/api/tasks?project_id={project['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1
