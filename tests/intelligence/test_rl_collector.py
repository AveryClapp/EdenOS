from datetime import datetime, timedelta
from backend.db import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import backend.models  # noqa — registers all models with Base


def _make_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def test_record_episode_stores_state_and_action():
    from backend.intelligence.rl_collector import record_episode
    from backend.models.rl_episode import RLEpisode
    db = _make_db()

    schedule_results = [
        {"task_id": "t1", "date": "2026-03-03", "start_time": "09:00", "end_time": "10:00"},
    ]
    state = {"tasks": [{"id": "t1", "cognitive_load": 2, "urgency": 1.5}]}

    record_episode(schedule_results, state, db)

    episodes = db.query(RLEpisode).all()
    assert len(episodes) == 1
    assert episodes[0].episode_complete is False
    assert episodes[0].reward is None
    import json
    action = json.loads(episodes[0].action)
    assert action[0]["task_id"] == "t1"


def test_compute_rewards_marks_complete_episodes():
    from backend.intelligence.rl_collector import record_episode, compute_rewards
    from backend.models.rl_episode import RLEpisode
    from backend.models.task import Task
    from backend.models.learning_record import LearningRecord
    from backend.models.goal import Goal
    from backend.models.project import Project
    import json

    db = _make_db()

    g = Goal(id="g1", title="G", tier="long", weight=1.0,
             target_date=datetime(2027, 1, 1).date(), status="active", created_at=datetime.utcnow())
    p = Project(id="p1", title="P", category="engineering", goal_id="g1",
                priority_score=0.0, status="active", estimated_hours_remaining=10.0)
    t = Task(id="t1", project_id="p1", title="T", cognitive_load=2,
             estimated_minutes=60, source="manual", status="done", created_at=datetime.utcnow())
    db.add_all([g, p, t])

    lr = LearningRecord(id="lr1", task_id="t1", estimated_minutes=60, actual_minutes=55,
                        energy_level_at_start=3, completion_quality=4,
                        recorded_at=datetime.utcnow())
    db.add(lr)
    db.commit()

    record_episode(
        [{"task_id": "t1", "date": "2026-03-03", "start_time": "09:00", "end_time": "10:00"}],
        {"tasks": []},
        db,
    )

    compute_rewards(db)

    episode = db.query(RLEpisode).first()
    assert episode.episode_complete is True
    assert episode.reward is not None


def test_reward_is_bounded():
    from backend.intelligence.rl_collector import _compute_single_reward
    reward = _compute_single_reward(
        completion_quality=5,
        estimated_minutes=60,
        actual_minutes=60,
        deadline=None,
        now=datetime.utcnow(),
    )
    assert -1.0 <= reward <= 1.0
