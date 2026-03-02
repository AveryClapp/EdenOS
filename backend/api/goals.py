import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.goal import Goal
from backend.models.project import Project
from backend.api.schemas import GoalCreate, GoalUpdate, GoalResponse

router = APIRouter(prefix="/api/goals", tags=["goals"])


@router.get("", response_model=list[GoalResponse])
def list_goals(db: Session = Depends(get_db)):
    return db.query(Goal).filter(Goal.status.notin_(["done", "dropped"])).all()


@router.post("", response_model=GoalResponse, status_code=201)
def create_goal(body: GoalCreate, db: Session = Depends(get_db)):
    goal = Goal(
        id=str(uuid.uuid4()),
        title=body.title,
        description=body.description,
        tier=body.tier,
        parent_id=body.parent_id,
        weight=body.weight,
        target_date=body.target_date,
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(goal_id: str, body: GoalUpdate, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    has_projects = db.query(Project).filter(
        Project.goal_id == goal_id,
        Project.status.notin_(["done", "dropped"]),
    ).first()
    if has_projects:
        raise HTTPException(status_code=409, detail="Cannot delete goal with active projects")
    # Also reject if has child goals
    has_children = db.query(Goal).filter(Goal.parent_id == goal_id).first()
    if has_children:
        raise HTTPException(status_code=409, detail="Cannot delete goal with child goals")
    db.delete(goal)
    db.commit()
