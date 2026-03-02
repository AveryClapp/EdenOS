import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.task import Task
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
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(task, field, value)
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
    db.commit()
    db.refresh(task)
    return task
