def test_list_memory_empty(client):
    r = client.get("/api/memory")
    assert r.status_code == 200
    assert r.json() == []

def test_create_memory(client):
    r = client.post("/api/memory", json={
        "category": "preference",
        "content": "prefers not to schedule admin before 10am",
        "confidence": 0.9,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["content"] == "prefers not to schedule admin before 10am"
    assert data["source"] == "user"
    assert data["is_active"] is True

def test_delete_memory(client):
    r = client.post("/api/memory", json={"category": "personal", "content": "training for Ironman", "confidence": 1.0})
    mem_id = r.json()["id"]
    del_r = client.delete(f"/api/memory/{mem_id}")
    assert del_r.status_code == 200
    assert client.get("/api/memory").json() == []

def test_toggle_memory_inactive(client):
    r = client.post("/api/memory", json={"category": "signal", "content": "felt burned out", "confidence": 0.7})
    mem_id = r.json()["id"]
    patch_r = client.patch(f"/api/memory/{mem_id}", json={"is_active": False})
    assert patch_r.status_code == 200
    assert patch_r.json()["is_active"] is False

def test_list_memory_only_active(client):
    r1 = client.post("/api/memory", json={"category": "preference", "content": "A", "confidence": 1.0})
    r2 = client.post("/api/memory", json={"category": "preference", "content": "B", "confidence": 1.0})
    client.patch(f"/api/memory/{r2.json()['id']}", json={"is_active": False})
    results = client.get("/api/memory").json()
    assert len(results) == 1
    assert results[0]["content"] == "A"
