import json
import anthropic
from sqlalchemy.orm import Session

from backend.config import settings
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task

GOAL_COVERAGE_THRESHOLD = 3  # Goals with fewer open tasks than this are "thin"

INFERENCE_SYSTEM_PROMPT = """You are Eden's goal planner.

Given a goal and its current open tasks, propose 3-5 concrete next tasks that would
move this goal forward. Each task should be actionable within a single work session.

Respond ONLY with a JSON array. Each element:
{"title": str, "cognitive_load": 1|2|3, "estimated_minutes": int, "project_id": str}

No markdown. No explanation. Just the JSON array.
"""


def check_goal_coverage(db: Session) -> list[dict]:
    """
    Check all active goals for thin task coverage.
    Returns a list of proposed task dicts for thin goals.
    All proposals use existing project_ids — no new projects created.
    """
    goals = db.query(Goal).filter(Goal.status == "active").all()
    if not goals:
        return []

    projects = db.query(Project).filter(Project.status == "active").all()
    project_by_goal: dict[str, list] = {}
    for p in projects:
        project_by_goal.setdefault(p.goal_id, []).append(p)

    all_tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()
    tasks_by_project: dict[str, list] = {}
    for t in all_tasks:
        tasks_by_project.setdefault(t.project_id, []).append(t)

    proposals = []

    for goal in goals:
        goal_projects = project_by_goal.get(goal.id, [])
        if not goal_projects:
            continue
        open_tasks = []
        for p in goal_projects:
            open_tasks.extend(tasks_by_project.get(p.id, []))

        if len(open_tasks) >= GOAL_COVERAGE_THRESHOLD:
            continue

        # Goal is thin — ask Claude for new tasks
        project = goal_projects[0]  # Target first active project
        try:
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            prompt = (
                f"Goal: {goal.title} (tier: {goal.tier})\n"
                f"Project: {project.title} (id: {project.id})\n"
                f"Current open tasks: {[t.title for t in open_tasks]}\n\n"
                f"Propose 3-5 concrete next tasks."
            )
            response = client.messages.create(
                model=settings.llm_model,
                max_tokens=512,
                system=INFERENCE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            task_list = json.loads(raw)
            for t in task_list:
                if "title" in t and "project_id" in t:
                    proposals.append(t)
        except Exception:
            continue

    return proposals
