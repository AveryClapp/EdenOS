"""
Goal decomposition commit endpoint.

Receives an approved propose_goal_tree payload from the frontend
and atomically creates: long-term Goal → mid-term Goals (milestones)
→ Projects → starter Tasks.
"""
import uuid
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.db import get_db
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task

router = APIRouter(prefix="/api/decompose", tags=["decompose"])


class StarterTask(BaseModel):
    title: str
    cognitive_load: int
    estimated_minutes: int
    description: str | None = None


class MilestoneProject(BaseModel):
    title: str
    category: str
    estimated_hours: float | None = None
    starter_tasks: list[StarterTask] = []


class Milestone(BaseModel):
    title: str
    target_date: str
    projects: list[MilestoneProject] = []


class LongTermGoal(BaseModel):
    title: str
    description: str | None = None
    target_date: str
    weight: float = 0.5


class GoalTreePayload(BaseModel):
    long_term_goal: LongTermGoal
    milestones: list[Milestone]


class GoalTreeResult(BaseModel):
    goal_id: str
    milestone_ids: list[str]
    project_ids: list[str]
    task_ids: list[str]


@router.post("/goal-tree", response_model=GoalTreeResult, status_code=201)
def commit_goal_tree(body: GoalTreePayload, db: Session = Depends(get_db)):
    """
    Atomically commit an approved goal tree to the database.
    Creates the long-term goal, milestone goals, projects, and starter tasks.
    """
    now = datetime.utcnow()
    milestone_ids: list[str] = []
    project_ids: list[str] = []
    task_ids: list[str] = []

    # Parse long-term goal target date
    try:
        lt_target = date.fromisoformat(body.long_term_goal.target_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid target_date format for long_term_goal")

    # Create long-term goal
    lt_goal = Goal(
        id=str(uuid.uuid4()),
        title=body.long_term_goal.title,
        description=body.long_term_goal.description,
        tier="long",
        weight=body.long_term_goal.weight,
        target_date=lt_target,
        status="active",
        created_at=now,
    )
    db.add(lt_goal)

    for milestone in body.milestones:
        try:
            ms_target = date.fromisoformat(milestone.target_date)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid target_date for milestone '{milestone.title}'")

        ms_goal = Goal(
            id=str(uuid.uuid4()),
            title=milestone.title,
            tier="mid",
            weight=body.long_term_goal.weight,
            target_date=ms_target,
            parent_id=lt_goal.id,
            status="active",
            created_at=now,
        )
        db.add(ms_goal)
        milestone_ids.append(ms_goal.id)

        for proj_def in milestone.projects:
            project = Project(
                id=str(uuid.uuid4()),
                title=proj_def.title,
                category=proj_def.category,
                goal_id=ms_goal.id,
                estimated_hours_remaining=proj_def.estimated_hours or 0.0,
                status="active",
            )
            db.add(project)
            project_ids.append(project.id)

            for task_def in proj_def.starter_tasks:
                task = Task(
                    id=str(uuid.uuid4()),
                    project_id=project.id,
                    title=task_def.title,
                    description=task_def.description,
                    cognitive_load=task_def.cognitive_load,
                    estimated_minutes=task_def.estimated_minutes,
                    status="backlog",
                    source="eden",
                    created_at=now,
                )
                db.add(task)
                task_ids.append(task.id)

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Commit failed: {exc}")

    # Recompute priorities after creating everything
    try:
        from backend.scheduler.priority import recompute_all_priorities
        recompute_all_priorities(db)
    except Exception:
        pass

    return GoalTreeResult(
        goal_id=lt_goal.id,
        milestone_ids=milestone_ids,
        project_ids=project_ids,
        task_ids=task_ids,
    )
