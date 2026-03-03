"""
RL data collection infrastructure.

Records scheduling decisions as (state, action) pairs and computes rewards
lazily once tasks complete. This corpus trains future RL agents to replace
hand-tuned soft constraint weights.

Reward formula (normalized to [-1, 1]):
  +completion_quality / 5          (quality of work, 0.0-1.0)
  +0.3 if |actual - estimated| / estimated < 0.2  (accurate estimation)
  -0.5 if task completed past deadline
  Clamped to [-1, 1]
"""
import json
import uuid
from datetime import datetime
from sqlalchemy.orm import Session

from backend.models.rl_episode import RLEpisode
from backend.models.task import Task
from backend.models.learning_record import LearningRecord


def record_episode(
    schedule_results: list[dict],
    state: dict,
    db: Session,
) -> None:
    """Store a new episode at scheduling time. Reward computed later."""
    episode = RLEpisode(
        id=str(uuid.uuid4()),
        scheduled_at=datetime.utcnow(),
        state=json.dumps(state, default=str),
        action=json.dumps(schedule_results, default=str),
        reward=None,
        reward_computed_at=None,
        episode_complete=False,
    )
    db.add(episode)
    db.commit()


def _compute_single_reward(
    completion_quality: int,
    estimated_minutes: int,
    actual_minutes: int,
    deadline: datetime | None,
    now: datetime,
) -> float:
    reward = completion_quality / 5.0
    if estimated_minutes > 0:
        ratio = abs(actual_minutes - estimated_minutes) / estimated_minutes
        if ratio < 0.2:
            reward += 0.3
    if deadline and now > deadline:
        reward -= 0.5
    return max(-1.0, min(1.0, reward))


def compute_rewards(db: Session) -> int:
    """
    Scan incomplete episodes and close them if all their tasks have learning records.
    Returns the number of episodes closed.
    """
    incomplete = db.query(RLEpisode).filter(RLEpisode.episode_complete == False).all()  # noqa: E712
    closed = 0
    now = datetime.utcnow()

    for episode in incomplete:
        try:
            action = json.loads(episode.action)
            task_ids = [a["task_id"] for a in action if a.get("task_id")]
            if not task_ids:
                episode.episode_complete = True
                continue

            tasks = db.query(Task).filter(Task.id.in_(task_ids)).all()

            all_resolved = all(
                t.status == "done" or (t.deadline and now > t.deadline)
                for t in tasks
            )
            if not all_resolved:
                continue

            rewards = []
            for t in tasks:
                lr = (
                    db.query(LearningRecord)
                    .filter(LearningRecord.task_id == t.id)
                    .order_by(LearningRecord.recorded_at.desc())
                    .first()
                )
                if lr:
                    r = _compute_single_reward(
                        completion_quality=lr.completion_quality,
                        estimated_minutes=lr.estimated_minutes,
                        actual_minutes=lr.actual_minutes,
                        deadline=t.deadline,
                        now=now,
                    )
                    rewards.append(r)

            if rewards:
                episode.reward = sum(rewards) / len(rewards)
            episode.reward_computed_at = now
            episode.episode_complete = True
            closed += 1
        except Exception:
            continue

    db.commit()
    return closed
