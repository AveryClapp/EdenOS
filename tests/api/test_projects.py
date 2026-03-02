import uuid


def _create_goal(client):
    return client.post("/api/goals", json={
        "title": "Root Goal", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()


def test_list_projects_empty(client):
    r = client.get("/api/projects")
    assert r.status_code == 200
    assert r.json() == []


def test_create_project(client):
    goal = _create_goal(client)
    r = client.post("/api/projects", json={
        "title": "Eden Backend",
        "category": "engineering",
        "goal_id": goal["id"],
        "estimated_hours_remaining": 80.0,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Eden Backend"
    assert data["priority_score"] == 0.0
    assert data["status"] == "active"


def test_get_project(client):
    goal = _create_goal(client)
    created = client.post("/api/projects", json={
        "title": "P", "category": "research", "goal_id": goal["id"]
    }).json()
    r = client.get(f"/api/projects/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_project_not_found(client):
    r = client.get(f"/api/projects/{uuid.uuid4()}")
    assert r.status_code == 404


def test_update_project(client):
    goal = _create_goal(client)
    created = client.post("/api/projects", json={
        "title": "P", "category": "engineering", "goal_id": goal["id"]
    }).json()
    r = client.patch(f"/api/projects/{created['id']}", json={"status": "paused", "estimated_hours_remaining": 10.0})
    assert r.status_code == 200
    assert r.json()["status"] == "paused"
    assert r.json()["estimated_hours_remaining"] == 10.0


def test_list_projects_excludes_dropped(client):
    goal = _create_goal(client)
    client.post("/api/projects", json={"title": "Active", "category": "research", "goal_id": goal["id"]})
    dropped = client.post("/api/projects", json={"title": "Dropped", "category": "research", "goal_id": goal["id"]}).json()
    client.patch(f"/api/projects/{dropped['id']}", json={"status": "dropped"})
    titles = [p["title"] for p in client.get("/api/projects").json()]
    assert "Active" in titles
    assert "Dropped" not in titles
