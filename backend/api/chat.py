from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.intelligence.client import EdenClient
from backend.api.schemas import (
    ChatRequest,
    ChatResponse,
    ProposedAction,
    ExecuteActionsRequest,
)
from backend.models.task import Task
from backend.models.project import Project

router = APIRouter(prefix="/api/chat", tags=["chat"])


def get_eden_client() -> EdenClient:
    return EdenClient()


def _describe_action(name: str, inp: dict, db: Session) -> str:
    """Return a short human-readable description for a proposed tool action."""
    if name == "create_task":
        project = db.get(Project, inp.get("project_id", ""))
        proj_name = project.title if project else inp.get("project_id", "?")
        load_map = {1: "easy", 2: "moderate", 3: "deep"}
        load = load_map.get(inp.get("cognitive_load", 2), "?")
        mins = inp.get("estimated_minutes", "?")
        return f"Create task \"{inp.get('title', '?')}\" in {proj_name} ({load}, ~{mins}m)"

    if name == "update_task":
        task = db.get(Task, inp.get("task_id", ""))
        task_name = task.title if task else inp.get("task_id", "?")
        changes = {k: v for k, v in inp.items() if k != "task_id"}
        change_str = ", ".join(f"{k}={v}" for k, v in changes.items())
        return f"Update task \"{task_name}\": {change_str}"

    if name == "delete_task":
        task = db.get(Task, inp.get("task_id", ""))
        task_name = task.title if task else inp.get("task_id", "?")
        return f"Delete task \"{task_name}\""

    if name == "create_project":
        return f"Create project \"{inp.get('title', '?')}\" ({inp.get('category', '?')})"

    if name == "update_project":
        project = db.get(Project, inp.get("project_id", ""))
        proj_name = project.title if project else inp.get("project_id", "?")
        return f"Update project \"{proj_name}\": status → {inp.get('status', '?')}"

    if name == "run_scheduler":
        return "Re-run the scheduler"

    return f"{name}({inp})"


def _ensure_general_goal(db: Session) -> str:
    """Return id of a 'General' goal, creating one if needed."""
    from backend.models.goal import Goal
    import uuid
    from datetime import date

    goal = db.query(Goal).filter(Goal.title == "General").first()
    if not goal:
        goal = Goal(
            id=str(uuid.uuid4()),
            title="General",
            tier="mid",
            weight=1.0,
            target_date=date(2099, 12, 31),
            status="active",
        )
        db.add(goal)
        db.commit()
    return goal.id


def _execute_tool(name: str, inp: dict, db: Session) -> None:
    """Execute a single approved tool action against the DB."""
    from backend.models.schedule_block import ScheduleBlock
    from backend.scheduler.engine import run as run_engine
    from backend.scheduler.priority import recompute_all_priorities
    import uuid

    if name == "create_task":
        task = Task(
            id=str(uuid.uuid4()),
            project_id=inp["project_id"],
            title=inp["title"],
            cognitive_load=inp.get("cognitive_load", 2),
            estimated_minutes=inp.get("estimated_minutes", 60),
            description=inp.get("description"),
            status="active",
            source="eden",
        )
        if inp.get("deadline"):
            from datetime import datetime
            try:
                task.deadline = datetime.fromisoformat(inp["deadline"])
            except ValueError:
                pass
        db.add(task)
        db.commit()
        recompute_all_priorities(db)

    elif name == "update_task":
        task = db.get(Task, inp["task_id"])
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        for field in ("title", "description", "status", "cognitive_load", "estimated_minutes"):
            if field in inp:
                setattr(task, field, inp[field])
        db.commit()
        recompute_all_priorities(db)

    elif name == "delete_task":
        task = db.get(Task, inp["task_id"])
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        db.query(ScheduleBlock).filter(ScheduleBlock.task_id == task.id).delete()
        db.delete(task)
        db.commit()
        recompute_all_priorities(db)

    elif name == "create_project":
        project = Project(
            id=str(uuid.uuid4()),
            title=inp["title"],
            category=inp.get("category", "personal"),
            goal_id=inp.get("goal_id") or _ensure_general_goal(db),
            estimated_hours_remaining=inp.get("estimated_hours_remaining", 0.0),
            status="active",
        )
        db.add(project)
        db.commit()
        recompute_all_priorities(db)

    elif name == "update_project":
        project = db.get(Project, inp["project_id"])
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if "status" in inp:
            project.status = inp["status"]
        db.commit()
        recompute_all_priorities(db)

    elif name == "run_scheduler":
        db.commit()
        run_engine(db)
        recompute_all_priorities(db)
        db.commit()


@router.post("", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    eden: EdenClient = Depends(get_eden_client),
):
    result = eden.chat(body.message, db)

    proposed: list[ProposedAction] = []
    for tu in result.get("tool_uses", []):
        description = _describe_action(tu["name"], tu["input"], db)
        proposed.append(
            ProposedAction(
                tool_use_id=tu["id"],
                name=tu["name"],
                input=tu["input"],
                description=description,
            )
        )

    return ChatResponse(
        content=result.get("content", ""),
        reasoning=result.get("reasoning", ""),
        proposed_actions=proposed,
    )


@router.post("/actions/execute")
def execute_actions(
    body: ExecuteActionsRequest,
    db: Session = Depends(get_db),
):
    """
    Execute approved actions from a previous chat response.
    Each item carries the full action (name + input) and an approved flag.
    Only approved=True items are executed; the rest are skipped silently.
    """
    executed = 0
    skipped = 0
    for item in body.actions:
        if item.approved:
            _execute_tool(item.name, item.input, db)
            executed += 1
        else:
            skipped += 1
    return {"executed": executed, "skipped": skipped}


@router.get("/alerts")
def get_alerts(db: Session = Depends(get_db), eden: EdenClient = Depends(get_eden_client)):
    return eden.get_alerts(db)
