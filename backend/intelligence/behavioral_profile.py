from sqlalchemy.orm import Session
from backend.models.learning_record import LearningRecord


def build_behavioral_profile(db: Session) -> dict:
    records = db.query(LearningRecord).all()
    if not records:
        return {"sample_count": 0, "notes": "No learning data yet."}

    by_load: dict[int, list] = {1: [], 2: [], 3: []}
    for r in records:
        load = getattr(r, 'cognitive_load', None)
        if load in by_load and r.estimated_minutes and r.actual_minutes:
            ratio = r.actual_minutes / r.estimated_minutes
            by_load[load].append(ratio)

    estimation_accuracy = {}
    for load, ratios in by_load.items():
        if len(ratios) >= 3:
            avg = sum(ratios) / len(ratios)
            label = {1: "low", 2: "moderate", 3: "deep_focus"}[load]
            estimation_accuracy[label] = round(avg, 2)

    notes = []
    for label, ratio in estimation_accuracy.items():
        if ratio > 1.2:
            notes.append(f"User runs {round((ratio-1)*100)}% over estimate on {label} tasks — pad scheduling.")
        elif ratio < 0.8:
            notes.append(f"User finishes {label} tasks {round((1-ratio)*100)}% faster than estimate.")

    return {
        "sample_count": len(records),
        "estimation_accuracy_by_load": estimation_accuracy,
        "scheduling_notes": notes,
    }
