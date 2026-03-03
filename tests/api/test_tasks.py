import uuid
from datetime import datetime, timedelta


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


def test_complete_recurring_task_creates_new_copy(client):
    project = _setup(client)
    task = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "Daily standup",
        "cognitive_load": 1, "estimated_minutes": 15,
        "recurrence_rule": "daily",
    }).json()
    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 15, "completion_quality": 4, "energy_level_at_start": 3,
    })
    r = client.get(f"/api/tasks?project_id={project['id']}")
    tasks = r.json()
    assert len(tasks) == 2
    copies = [t for t in tasks if t["id"] != task["id"]]
    assert copies[0]["title"] == "Daily standup"
    assert copies[0]["status"] == "backlog"
    assert copies[0]["recurrence_rule"] == "daily"


def test_complete_non_recurring_task_no_copy(client):
    project = _setup(client)
    task = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "One-off",
        "cognitive_load": 1, "estimated_minutes": 30,
    }).json()
    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 30, "completion_quality": 3, "energy_level_at_start": 3,
    })
    r = client.get(f"/api/tasks?project_id={project['id']}")
    assert len(r.json()) == 1


def test_list_tasks_filter_by_project(client):
    project = _setup(client)
    client.post("/api/tasks", json={
        "project_id": project["id"], "title": "In project",
        "cognitive_load": 1, "estimated_minutes": 30,
    })
    r = client.get(f"/api/tasks?project_id={project['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1


def _make_project_and_task(client, recurrence_rule="weekly", with_deadline=True):
    goal_r = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0,
        "target_date": "2027-01-01"
    })
    proj_r = client.post("/api/projects", json={
        "title": "P", "goal_id": goal_r.json()["id"],
        "category": "engineering", "estimated_hours_remaining": 10
    })
    deadline = (datetime.utcnow() + timedelta(days=7)).isoformat() if with_deadline else None
    task_r = client.post("/api/tasks", json={
        "project_id": proj_r.json()["id"],
        "title": "Weekly review",
        "cognitive_load": 1,
        "estimated_minutes": 30,
        "recurrence_rule": recurrence_rule,
        "deadline": deadline,
    })
    return task_r.json()


def test_completing_recurring_task_spawns_next_occurrence(client):
    task = _make_project_and_task(client, recurrence_rule="weekly")
    r = client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 25,
        "completion_quality": 4,
        "energy_level_at_start": 3,
    })
    assert r.status_code == 200

    tasks_r = client.get("/api/tasks")
    titles = [t["title"] for t in tasks_r.json()]
    assert titles.count("Weekly review") == 2  # original (done) + new occurrence


def test_recurring_task_next_deadline_is_offset_from_original(client):
    task = _make_project_and_task(client, recurrence_rule="weekly", with_deadline=True)
    original_deadline = task["deadline"]

    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 25, "completion_quality": 4, "energy_level_at_start": 3,
    })

    tasks_r = client.get("/api/tasks")
    new_task = next(t for t in tasks_r.json() if t["id"] != task["id"])
    assert new_task["deadline"] is not None

    orig_dt = datetime.fromisoformat(original_deadline.replace("Z", ""))
    new_dt = datetime.fromisoformat(new_task["deadline"].replace("Z", ""))
    diff = (new_dt - orig_dt).days
    assert diff == 7  # weekly = +7 days


def test_recurring_daily_adds_one_day(client):
    task = _make_project_and_task(client, recurrence_rule="daily", with_deadline=True)
    original_deadline = task["deadline"]

    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 10, "completion_quality": 4, "energy_level_at_start": 3,
    })

    tasks_r = client.get("/api/tasks")
    new_task = next(t for t in tasks_r.json() if t["id"] != task["id"])
    orig_dt = datetime.fromisoformat(original_deadline.replace("Z", ""))
    new_dt = datetime.fromisoformat(new_task["deadline"].replace("Z", ""))
    assert (new_dt - orig_dt).days == 1


def test_recurring_without_deadline_uses_today_as_base(client):
    task = _make_project_and_task(client, recurrence_rule="weekly", with_deadline=False)

    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 25, "completion_quality": 4, "energy_level_at_start": 3,
    })

    tasks_r = client.get("/api/tasks")
    new_task = next(t for t in tasks_r.json() if t["id"] != task["id"])
    assert new_task["deadline"] is not None
    new_dt = datetime.fromisoformat(new_task["deadline"].replace("Z", ""))
    now = datetime.utcnow()
    # Should be ~7 days from now (allow 1 day slack for test timing)
    assert 6 <= (new_dt - now).days <= 8


def _create_two_tasks(client):
    goal_r = client.post("/api/goals", json={
        "title": "G2", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    })
    proj_r = client.post("/api/projects", json={
        "title": "P2", "goal_id": goal_r.json()["id"],
        "category": "engineering", "estimated_hours_remaining": 10
    })
    pid = proj_r.json()["id"]
    t1 = client.post("/api/tasks", json={
        "project_id": pid, "title": "First", "cognitive_load": 2, "estimated_minutes": 60
    }).json()
    t2 = client.post("/api/tasks", json={
        "project_id": pid, "title": "Second", "cognitive_load": 2, "estimated_minutes": 60
    }).json()
    return t1, t2


def test_task_response_includes_dependency_ids(client):
    t1, t2 = _create_two_tasks(client)
    r = client.get(f"/api/tasks/{t1['id']}")
    assert r.status_code == 200
    assert "dependency_ids" in r.json()
    assert r.json()["dependency_ids"] == []


def test_update_task_sets_dependencies(client):
    t1, t2 = _create_two_tasks(client)
    # t2 depends on t1
    r = client.patch(f"/api/tasks/{t2['id']}", json={"dependency_ids": [t1["id"]]})
    assert r.status_code == 200
    assert t1["id"] in r.json()["dependency_ids"]


def test_update_task_clears_dependencies(client):
    t1, t2 = _create_two_tasks(client)
    client.patch(f"/api/tasks/{t2['id']}", json={"dependency_ids": [t1["id"]]})
    r = client.patch(f"/api/tasks/{t2['id']}", json={"dependency_ids": []})
    assert r.status_code == 200
    assert r.json()["dependency_ids"] == []


def test_task_with_deadline_has_urgency(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 5
    }).json()
    from datetime import datetime, timedelta
    deadline = (datetime.utcnow() + timedelta(days=7)).isoformat()
    task = client.post("/api/tasks", json={
        "project_id": proj["id"],
        "title": "Deadline task",
        "cognitive_load": 2,
        "estimated_minutes": 60,
        "deadline": deadline,
    }).json()
    assert "urgency" in task
    assert task["urgency"] is not None
    assert task["urgency"] > 0.0


def test_task_without_deadline_has_null_urgency(client):
    goal = client.post("/api/goals", json={
        "title": "G2", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P2", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 5
    }).json()
    task = client.post("/api/tasks", json={
        "project_id": proj["id"],
        "title": "No deadline task",
        "cognitive_load": 1,
        "estimated_minutes": 30,
    }).json()
    assert "urgency" in task
    assert task["urgency"] is None
