def test_list_empty(client):
    r = client.get("/api/availability")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_list(client):
    body = {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"}
    r = client.post("/api/availability", json=body)
    assert r.status_code == 201
    data = r.json()
    assert data["day_of_week"] == 0
    assert data["is_available"] is True
    assert "09:00" in data["start_time"]

    r = client.get("/api/availability")
    assert len(r.json()) == 1


def test_create_every_day(client):
    r = client.post("/api/availability", json={"start_time": "08:00", "end_time": "20:00"})
    assert r.status_code == 201
    assert r.json()["day_of_week"] is None


def test_update(client):
    r = client.post("/api/availability", json={"start_time": "09:00", "end_time": "17:00"})
    wid = r.json()["id"]
    r = client.patch(f"/api/availability/{wid}", json={"end_time": "18:00"})
    assert r.status_code == 200
    assert "18:00" in r.json()["end_time"]


def test_delete(client):
    r = client.post("/api/availability", json={"start_time": "09:00", "end_time": "17:00"})
    wid = r.json()["id"]
    r = client.delete(f"/api/availability/{wid}")
    assert r.status_code == 204
    r = client.get("/api/availability")
    assert r.json() == []


def test_404_patch(client):
    r = client.patch("/api/availability/nonexistent", json={"end_time": "18:00"})
    assert r.status_code == 404


def test_404_delete(client):
    r = client.delete("/api/availability/nonexistent")
    assert r.status_code == 404
