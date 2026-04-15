"""
Proactive identity and behavioral pattern tracking.
Called after task completions to reinforce or create behavioral_pattern memories.
Never calls the LLM — purely rule-based observation.
"""
from datetime import datetime
from sqlalchemy.orm import Session

from backend.models.user_memory import UserMemory, MEMORY_CATEGORIES


def _upsert_memory(category: str, content: str, db: Session) -> None:
    """
    Insert a new memory or reinforce an existing one with matching category + prefix.
    Uses the first 50 chars of content as a dedup key.
    """
    prefix = content[:50]
    existing = db.query(UserMemory).filter(
        UserMemory.is_active == True,
        UserMemory.category == category,
        UserMemory.content.contains(prefix),
    ).first()

    if existing:
        existing.observation_count = (existing.observation_count or 1) + 1
        existing.updated_at = datetime.utcnow()
        existing.confidence = min(1.0, existing.confidence + 0.05)
    else:
        db.add(UserMemory(
            category=category,
            content=content,
            source="system",
            confidence=0.6,
            created_at=datetime.utcnow(),
        ))

    db.commit()


def update_identity_from_completion(
    task_actual_minutes: int,
    task_estimated_minutes: int,
    cognitive_load: int,
    db: Session,
) -> None:
    """
    Called after a task completion. Detects patterns and writes/reinforces
    behavioral_pattern memories without calling the LLM.
    """
    if task_estimated_minutes <= 0:
        return

    ratio = task_actual_minutes / task_estimated_minutes

    # Deep work underestimation pattern
    if cognitive_load == 3 and ratio > 1.35:
        _upsert_memory(
            "behavioral_pattern",
            "Consistently underestimates deep work (load=3) tasks — actual duration runs 35%+ over estimate.",
            db,
        )

    # Consistent overestimation
    elif ratio < 0.6:
        _upsert_memory(
            "behavioral_pattern",
            "Often overestimates task duration — actual completion is frequently under 60% of estimate.",
            db,
        )

    # Fast executor on light tasks
    if cognitive_load == 1 and ratio < 0.7:
        _upsert_memory(
            "behavioral_pattern",
            "Completes light (load=1) tasks quickly — typically finishes well under estimated time.",
            db,
        )
