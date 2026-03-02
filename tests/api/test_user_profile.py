def test_get_user_profile_empty(client):
    r = client.get("/api/user-profile")
    assert r.status_code == 200
    data = r.json()
    assert data["wake_hour"] == 7
    assert data["chronotype"] == "intermediate"


def test_update_user_profile(client):
    r = client.put("/api/user-profile", json={"wake_hour": 6, "chronotype": "early"})
    assert r.status_code == 200
    data = r.json()
    assert data["wake_hour"] == 6
    assert data["chronotype"] == "early"


def test_update_persists(client):
    client.put("/api/user-profile", json={"wake_hour": 9, "chronotype": "late"})
    r = client.get("/api/user-profile")
    assert r.json()["wake_hour"] == 9


def test_get_energy_defaults(client):
    client.put("/api/user-profile", json={"wake_hour": 7, "chronotype": "intermediate"})
    r = client.get("/api/user-profile/energy-defaults")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 168
    assert all("day_of_week" in e and "hour_of_day" in e and "energy_level" in e for e in data)


def test_energy_defaults_reflect_wake_hour(client):
    client.put("/api/user-profile", json={"wake_hour": 8, "chronotype": "intermediate"})
    r = client.get("/api/user-profile/energy-defaults")
    entries = r.json()
    # wake_hour=8 → peak window hours 10,11,12 (offsets 2,3,4)
    peak = [e for e in entries if e["day_of_week"] == 0 and e["hour_of_day"] in (10, 11, 12)]
    assert all(e["energy_level"] == 5 for e in peak)


def test_wake_hour_validation(client):
    r = client.put("/api/user-profile", json={"wake_hour": 25, "chronotype": "intermediate"})
    assert r.status_code == 422


def test_chronotype_validation(client):
    r = client.put("/api/user-profile", json={"wake_hour": 7, "chronotype": "vampire"})
    assert r.status_code == 422
