"""
Health observations endpoint.

Rule-based cross-domain synthesis — no WHOOP data mirrored.
Returns interpretations: what the data means in context of schedule and goals.
"""
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/observations")
def get_observations(db: Session = Depends(get_db)):
    from backend.models.whoop_daily import WhoopDaily
    from backend.models.schedule_block import ScheduleBlock
    from backend.models.task import Task
    from backend.models.learning_record import LearningRecord

    today = date.today()
    observations = []

    # Last 7 days of WHOOP data
    seven_days_ago = today - timedelta(days=7)
    recents = (
        db.query(WhoopDaily)
        .filter(WhoopDaily.date >= seven_days_ago, WhoopDaily.date <= today)
        .order_by(WhoopDaily.date)
        .all()
    )
    scores = [r.recovery_score for r in recents if r.recovery_score is not None]
    strains = [r.strain_score for r in recents if r.strain_score is not None]
    today_whoop = next((r for r in recents if r.date == today), None)

    if not scores:
        return {"observations": [], "capacity": "unknown", "schedule_adapted": False}

    today_score = today_whoop.recovery_score if today_whoop else None

    # Capacity label (no number shown to frontend — just semantic)
    if today_score is None:
        capacity = "unknown"
    elif today_score < 34:
        capacity = "limited"
    elif today_score < 67:
        capacity = "reduced"
    else:
        capacity = "full"

    # Did the schedule get adapted?
    today_blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == today,
        ScheduleBlock.is_draft == False,
        ScheduleBlock.task_id.isnot(None),
    ).all()
    task_ids_today = [b.task_id for b in today_blocks]
    deep_blocks_today = 0
    if task_ids_today:
        deep_blocks_today = db.query(Task).filter(
            Task.id.in_(task_ids_today),
            Task.cognitive_load == 3,
        ).count()

    schedule_adapted = capacity in ("limited", "reduced")

    # ── Observations ──────────────────────────────────────────────────────────

    # 1. Consecutive low-recovery days
    if len(scores) >= 2:
        consecutive_low = 0
        for s in reversed(scores):
            if s < 67:
                consecutive_low += 1
            else:
                break
        if consecutive_low >= 3:
            severity = "high" if consecutive_low >= 4 else "medium"

            # Cross-check: were those days heavy on scheduled blocks?
            heavy_days = 0
            for r in recents[-consecutive_low:]:
                block_count = db.query(ScheduleBlock).filter(
                    ScheduleBlock.date == r.date,
                    ScheduleBlock.is_draft == False,
                ).count()
                if block_count >= 4:
                    heavy_days += 1

            msg = f"{consecutive_low} consecutive days below green recovery."
            if heavy_days >= consecutive_low - 1:
                msg += f" Coincides with {heavy_days} heavily scheduled days — likely the cause."

            observations.append({"severity": severity, "message": msg,
                                  "type": "recovery_trend"})

    # 2. Schedule adaptation note
    if schedule_adapted:
        total_blocks = len(today_blocks)
        if capacity == "limited":
            msg = f"Today's schedule was tightened significantly — only load-1 and load-2 tasks auto-scheduled."
        else:
            msg = f"Schedule trimmed for reduced recovery — deep work weighted down in slot assignment."
        if deep_blocks_today == 0 and total_blocks > 0:
            msg += " No deep-focus blocks placed today."
        elif deep_blocks_today > 0:
            msg += f" {deep_blocks_today} deep-focus block{'s' if deep_blocks_today > 1 else ''} survived the cut."
        observations.append({"severity": "medium", "message": msg,
                              "type": "schedule_adapted"})

    # 3. High strain + low recovery pattern
    if len(strains) >= 3 and len(scores) >= 3:
        avg_strain = sum(strains[-3:]) / len(strains[-3:])
        avg_recovery = sum(scores[-3:]) / len(scores[-3:])
        if avg_strain > 14 and avg_recovery < 60:
            observations.append({
                "severity": "high",
                "message": "High strain and low recovery have overlapped for 3+ days. "
                           "Scheduling lighter tasks today is unlikely to be enough — consider tomorrow too.",
                "type": "strain_recovery_conflict",
            })

    # 4. Learning records: are task estimates getting worse during low-recovery periods?
    try:
        recent_records = (
            db.query(LearningRecord)
            .order_by(LearningRecord.recorded_at.desc())
            .limit(20)
            .all()
        )
        if len(recent_records) >= 5:
            load3_records = [r for r in recent_records if r.task and r.task.cognitive_load == 3]
            if len(load3_records) >= 3:
                ratios = [r.actual_minutes / r.estimated_minutes for r in load3_records]
                avg_ratio = sum(ratios) / len(ratios)
                if avg_ratio > 1.4 and capacity in ("limited", "reduced"):
                    observations.append({
                        "severity": "medium",
                        "message": f"Deep work tasks are taking {round((avg_ratio - 1) * 100)}% longer than estimated on average. "
                                   "Reduced recovery likely a factor — estimates adjusted in scheduler.",
                        "type": "estimation_drift",
                    })
    except Exception:
        pass

    # 5. Recovery improving after a dip
    if len(scores) >= 4 and not any(o["type"] == "recovery_trend" for o in observations):
        if scores[-1] > scores[-2] > scores[-3] and scores[-3] < 67:
            observations.append({
                "severity": "low",
                "message": "Recovery trending upward after a dip. "
                           "Deep work blocks will be re-weighted higher tomorrow if the trend holds.",
                "type": "recovery_improving",
            })

    # 6. No data for >2 days
    if len(scores) == 0 or (today_whoop is None and len(scores) < 2):
        observations.append({
            "severity": "low",
            "message": "No recent WHOOP data — schedule running on energy profile defaults only.",
            "type": "no_data",
        })

    return {
        "observations": observations,
        "capacity": capacity,
        "schedule_adapted": schedule_adapted,
        "blocks_today": len(today_blocks),
        "deep_blocks_today": deep_blocks_today,
    }
