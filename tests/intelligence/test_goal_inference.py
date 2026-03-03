from unittest.mock import patch, MagicMock


def _make_db_with_thin_goal():
    """Return a mock DB session with one active goal that has 1 open task."""
    goal = MagicMock()
    goal.id = "goal-1"
    goal.title = "Learn Rust"
    goal.status = "active"
    goal.tier = "long"

    project = MagicMock()
    project.id = "proj-1"
    project.goal_id = "goal-1"
    project.status = "active"
    project.title = "Rust exercises"

    task = MagicMock()
    task.status = "active"
    task.project_id = "proj-1"

    db = MagicMock()
    db.query.return_value.filter.return_value.all.side_effect = [
        [goal],      # goals query
        [project],   # projects query
        [task],      # tasks query
    ]
    return db, goal, project


def test_thin_goal_triggers_inference():
    from backend.intelligence.goal_inference import check_goal_coverage
    db, goal, project = _make_db_with_thin_goal()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(type="text", text='[{"title": "Read Rust book ch.1", "cognitive_load": 2, "estimated_minutes": 60, "project_id": "proj-1"}]')]

    with patch("backend.intelligence.goal_inference.anthropic.Anthropic") as MockAnth:
        MockAnth.return_value.messages.create.return_value = mock_response
        proposals = check_goal_coverage(db)

    assert len(proposals) >= 1
    assert proposals[0]["title"] == "Read Rust book ch.1"


def test_well_covered_goal_skips_inference():
    from backend.intelligence.goal_inference import check_goal_coverage

    goal = MagicMock()
    goal.id = "goal-1"
    goal.status = "active"

    project = MagicMock()
    project.id = "proj-1"
    project.goal_id = "goal-1"
    project.status = "active"

    tasks = [MagicMock(status="active", project_id="proj-1") for _ in range(4)]

    db = MagicMock()
    db.query.return_value.filter.return_value.all.side_effect = [
        [goal], [project], tasks,
    ]

    with patch("backend.intelligence.goal_inference.anthropic.Anthropic") as MockAnth:
        proposals = check_goal_coverage(db)
        MockAnth.return_value.messages.create.assert_not_called()

    assert proposals == []
