import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import get_db

_RECURRENCE_INTERVALS: dict[str, timedelta] = {
    "daily":    timedelta(days=1),
    "weekly":   timedelta(days=7),
    "biweekly": timedelta(days=14),
    "monthly":  timedelta(days=30),
}
from backend.models.project import Project
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord
from backend.api.schemas import TaskCreate, TaskUpdate, TaskComplete, TaskResponse

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
def list_tasks(project_id: str | None = Query(default=None), db: Session = Depends(get_db)):
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    return q.all()


@router.post("", response_model=TaskResponse, status_code=201)
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    task = Task(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        title=body.title,
        description=body.description,
        cognitive_load=body.cognitive_load,
        estimated_minutes=body.estimated_minutes,
        deadline=body.deadline,
        recurrence_rule=body.recurrence_rule,
        source=body.source,
        status="backlog",
        created_at=datetime.utcnow(),
    )
    db.add(task)
    db.flush()

    if body.dependency_ids:
        deps = db.query(Task).filter(Task.id.in_(body.dependency_ids)).all()
        task.dependencies = deps

    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = body.model_dump(exclude_none=True)
    dependency_ids = data.pop('dependency_ids', None)

    for field, value in data.items():
        setattr(task, field, value)

    if dependency_ids is not None:
        deps = db.query(Task).filter(Task.id.in_(dependency_ids)).all() if dependency_ids else []
        task.dependencies = deps

    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: str, body: TaskComplete, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = "done"
    task.actual_minutes = body.actual_minutes

    # Decrement project's estimated hours remaining
    project = db.query(Project).filter(Project.id == task.project_id).first()
    if project:
        hours_spent = body.actual_minutes / 60.0
        project.estimated_hours_remaining = max(0.0, project.estimated_hours_remaining - hours_spent)

    record = LearningRecord(
        id=str(uuid.uuid4()),
        task_id=task.id,
        estimated_minutes=task.estimated_minutes,
        actual_minutes=body.actual_minutes,
        energy_level_at_start=body.energy_level_at_start,
        completion_quality=body.completion_quality,
        recorded_at=datetime.utcnow(),
    )
    db.add(record)

    if task.recurrence_rule:
        interval = _RECURRENCE_INTERVALS.get(task.recurrence_rule)
        next_deadline: datetime | None = None
        if interval:
            base = task.deadline if task.deadline else datetime.utcnow()
            next_deadline = base + interval
        recurrence_copy = Task(
            id=str(uuid.uuid4()),
            project_id=task.project_id,
            title=task.title,
            description=task.description,
            cognitive_load=task.cognitive_load,
            estimated_minutes=task.estimated_minutes,
            recurrence_rule=task.recurrence_rule,
            deadline=next_deadline,
            source=task.source,
            status="backlog",
            created_at=datetime.utcnow(),
        )
        db.add(recurrence_copy)

    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.query(ScheduleBlock).filter(ScheduleBlock.task_id == task_id).delete(synchronize_session=False)
    db.delete(task)
    db.commit()
