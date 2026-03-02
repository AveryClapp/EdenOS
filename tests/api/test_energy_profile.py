import pytest


def test_get_empty(client):
    r = client.get("/api/energy-profile")
    assert r.status_code == 200
    assert r.json() == []


def test_put_and_get(client):
    body = {
        "entries": [
            {"hour_of_day": 9, "day_of_week": 0, "energy_level": 4},
            {"hour_of_day": 10, "day_of_week": 0, "energy_level": 5},
        ]
    }
    r = client.put("/api/energy-profile", json=body)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert all("id" in e for e in data)

    r = client.get("/api/energy-profile")
    assert len(r.json()) == 2


def test_put_replaces_all(client):
    client.put("/api/energy-profile", json={"entries": [
        {"hour_of_day": 9, "day_of_week": 0, "energy_level": 3}
    ]})
    r = client.put("/api/energy-profile", json={"entries": [
        {"hour_of_day": 8, "day_of_week": 1, "energy_level": 2},
        {"hour_of_day": 9, "day_of_week": 1, "energy_level": 4},
    ]})
    assert len(r.json()) == 2
    r = client.get("/api/energy-profile")
    assert len(r.json()) == 2


def test_put_empty_clears(client):
    client.put("/api/energy-profile", json={"entries": [
        {"hour_of_day": 9, "day_of_week": 0, "energy_level": 3}
    ]})
    r = client.put("/api/energy-profile", json={"entries": []})
    assert r.status_code == 200
    assert r.json() == []
