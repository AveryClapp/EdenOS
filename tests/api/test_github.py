from datetime import date
from unittest.mock import patch, MagicMock


FAKE_ISSUE = {
    "id": 111111,
    "title": "Fix login bug",
    "body": "Login fails for OAuth users.",
    "html_url": "https://github.com/owner/repo/issues/1",
}

FAKE_PR = {
    "id": 222222,
    "title": "Add dark mode",
    "body": "Implements dark mode toggle.",
    "html_url": "https://github.com/owner/repo/pull/2",
    "pull_request": {"url": "https://api.github.com/..."},
}


def _make_project(db):
    from backend.models.goal import Goal
    from backend.models.project import Project

    goal = Goal(
        id="g1", title="Test Goal", tier="long", status="active",
        weight=1.0, target_date=date(2027, 1, 1),
    )
    project = Project(
        id="p1", title="Test Project", category="engineering",
        goal_id="g1", status="active", priority_score=0.5,
        estimated_hours_remaining=10.0,
    )
    db.add_all([goal, project])
    db.commit()
    return project


def _patched_sync(client, project_id="p1", issues=None, prs=None):
    mock_gh = MagicMock()
    mock_gh.get_assigned_issues.return_value = issues or []
    mock_gh.get_review_requested_prs.return_value = prs or []
    with patch("backend.api.github.settings") as mock_settings, \
         patch("backend.api.github.GitHubClient", return_value=mock_gh):
        mock_settings.github_token = "fake-token"
        return client.post(f"/api/github/sync?project_id={project_id}")


def test_sync_no_token(client):
    with patch("backend.api.github.settings") as mock_settings:
        mock_settings.github_token = ""
        r = client.post("/api/github/sync?project_id=p1")
    assert r.status_code == 400


def test_sync_imports_issues_and_prs(client, db):
    _make_project(db)
    r = _patched_sync(client, issues=[FAKE_ISSUE], prs=[FAKE_PR])
    assert r.status_code == 200
    assert r.json() == {"imported": 2, "skipped": 0}


def test_sync_deduplicates(client, db):
    _make_project(db)
    r = _patched_sync(client, issues=[FAKE_ISSUE])
    assert r.json()["imported"] == 1
    r = _patched_sync(client, issues=[FAKE_ISSUE])
    assert r.json()["imported"] == 0
    assert r.json()["skipped"] == 1


def test_sync_no_project_id(client):
    r = client.post("/api/github/sync")
    assert r.status_code == 422


def test_sync_tasks_have_github_source(client, db):
    _make_project(db)
    _patched_sync(client, issues=[FAKE_ISSUE])
    from backend.models.task import Task
    tasks = db.query(Task).all()
    assert len(tasks) == 1
    assert tasks[0].source == "github"
    assert tasks[0].external_id == str(FAKE_ISSUE["id"])
