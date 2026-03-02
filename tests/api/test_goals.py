import uuid
from datetime import date


def test_list_goals_empty(client):
    r = client.get("/api/goals")
    assert r.status_code == 200
    assert r.json() == []


def test_create_goal(client):
    r = client.post("/api/goals", json={
        "title": "Publish paper",
        "tier": "long",
        "weight": 0.9,
        "target_date": "2027-01-01",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Publish paper"
    assert data["tier"] == "long"
    assert data["status"] == "active"
    assert "id" in data


def test_get_goal(client):
    created = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 0.5, "target_date": "2026-06-01"
    }).json()
    r = client.get(f"/api/goals/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_goal_not_found(client):
    r = client.get(f"/api/goals/{uuid.uuid4()}")
    assert r.status_code == 404


def test_update_goal_status(client):
    created = client.post("/api/goals", json={
        "title": "G", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    r = client.patch(f"/api/goals/{created['id']}", json={"status": "paused"})
    assert r.status_code == 200
    assert r.json()["status"] == "paused"


def test_list_goals_excludes_dropped(client):
    client.post("/api/goals", json={
        "title": "Active", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    })
    dropped = client.post("/api/goals", json={
        "title": "Dropped", "tier": "long", "weight": 0.1, "target_date": "2026-01-01"
    }).json()
    client.patch(f"/api/goals/{dropped['id']}", json={"status": "dropped"})
    r = client.get("/api/goals")
    titles = [g["title"] for g in r.json()]
    assert "Active" in titles
    assert "Dropped" not in titles
