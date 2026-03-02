import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.project import Project
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.api.schemas import ProjectCreate, ProjectUpdate, ProjectResponse

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).filter(Project.status.notin_(["done", "dropped"])).all()


@router.post("", response_model=ProjectResponse, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(
        id=str(uuid.uuid4()),
        title=body.title,
        category=body.category,
        motivation=body.motivation,
        goal_id=body.goal_id,
        estimated_hours_remaining=body.estimated_hours_remaining,
        github_repo=body.github_repo,
        priority_score=0.0,
        status="active",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task_ids = [t.id for t in db.query(Task.id).filter(Task.project_id == project_id).all()]
    if task_ids:
        db.query(ScheduleBlock).filter(ScheduleBlock.task_id.in_(task_ids)).delete(synchronize_session=False)
        db.query(Task).filter(Task.project_id == project_id).delete(synchronize_session=False)
    db.delete(project)
    db.commit()
