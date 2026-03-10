import uuid
import json
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.config import settings
from backend.db import get_db
from backend.intelligence.client import EdenClient
from backend.intelligence.context import build_context_snapshot
from backend.intelligence.prompts import PLAN_GENERATION_PROMPT
from backend.models.schedule_block import ScheduleBlock
from backend.models.task import Task

router = APIRouter(prefix="/api/plan", tags=["plan"])


def _parse_time(t: str) -> time:
    h, m = t.split(":")
    return time(int(h), int(m))


def _generate_for_date(target_date: date, db: Session) -> dict:
    """Core logic: generate draft blocks for one date. Returns {blocks, summary}."""
    # Delete existing drafts for this date
    db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).delete()
    db.commit()

    snapshot = build_context_snapshot(db)
    context_str = json.dumps(snapshot, default=str, indent=2)

    tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()
    task_list = [
        {"id": t.id, "title": t.title, "cognitive_load": t.cognitive_load,
         "estimated_minutes": t.estimated_minutes,
         "deadline": str(t.deadline) if t.deadline else None}
        for t in tasks
    ]

    user_content = f"""<context>
{context_str}
</context>

Target date: {target_date}
Tasks to consider scheduling: {json.dumps(task_list)}

Propose a schedule for {target_date}."""

    client = EdenClient()
    msg = client._client.messages.create(
        model=settings.llm_model,
        max_tokens=2048,
        system=PLAN_GENERATION_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    text = next((b.text for b in msg.content if b.type == "text"), "{}")
    try:
        proposal = json.loads(text)
    except json.JSONDecodeError:
        proposal = {"blocks": [], "summary": "Could not parse schedule proposal."}

    created_blocks = []
    for b in proposal.get("blocks", []):
        try:
            block = ScheduleBlock(
                id=str(uuid.uuid4()),
                task_id=b.get("task_id"),
                date=target_date,
                start_time=_parse_time(b["start_time"]),
                end_time=_parse_time(b["end_time"]),
                auto_generated=True,
                overridden_by_user=False,
                is_draft=True,
            )
            db.add(block)
            created_blocks.append({
                "id": block.id,
                "task_id": block.task_id,
                "date": str(block.date),
                "start_time": b["start_time"],
                "end_time": b["end_time"],
                "reason": b.get("reason", ""),
            })
        except (KeyError, ValueError):
            continue

    db.commit()
    return {"blocks": created_blocks, "summary": proposal.get("summary", "")}


@router.post("/generate")
def generate_plan(target_date: date = Query(default=None), db: Session = Depends(get_db)):
    if target_date is None:
        from datetime import date as _date
        target_date = _date.today()

    result = _generate_for_date(target_date, db)
    return {
        "blocks": result["blocks"],
        "summary": result["summary"],
        "date": str(target_date),
    }


@router.post("/generate-week")
def generate_week(start_date: date = Query(...), db: Session = Depends(get_db)):
    results = []
    for i in range(7):
        day = start_date + timedelta(days=i)
        day_result = _generate_for_date(day, db)
        results.append({"date": str(day), **day_result})
    return {"days": results, "week_start": str(start_date)}


@router.post("/lock")
def lock_plan(target_date: date = Query(...), db: Session = Depends(get_db)):
    drafts = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).all()
    for block in drafts:
        block.is_draft = False
    db.commit()
    return {"locked": len(drafts), "date": str(target_date)}


@router.post("/lock-week")
def lock_week(start_date: date = Query(...), db: Session = Depends(get_db)):
    end_date = start_date + timedelta(days=7)
    drafts = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= start_date,
        ScheduleBlock.date < end_date,
        ScheduleBlock.is_draft == True,
    ).all()
    for block in drafts:
        block.is_draft = False
    db.commit()
    return {"locked": len(drafts), "week_start": str(start_date)}


@router.delete("/{target_date}")
def discard_plan(target_date: date, db: Session = Depends(get_db)):
    deleted = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).delete()
    db.commit()
    return {"discarded": deleted, "date": str(target_date)}
