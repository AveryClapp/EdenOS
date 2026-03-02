import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.config import settings
from backend.integrations.github import GitHubClient
from backend.models.task import Task

router = APIRouter(prefix="/api/github", tags=["github"])


@router.post("/sync")
def sync_github(
    project_id: str = Query(..., description="Project ID to import tasks into"),
    db: Session = Depends(get_db),
):
    if not settings.github_token:
        raise HTTPException(status_code=400, detail="GITHUB_TOKEN not configured")

    client = GitHubClient(settings.github_token)

    try:
        items: list[dict] = []
        items += client.get_assigned_issues()
        items += client.get_review_requested_prs()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {e}")

    imported = 0
    skipped = 0
    seen: set[str] = set()

    for item in items:
        external_id = str(item["id"])
        if external_id in seen:
            continue
        seen.add(external_id)

        existing = db.query(Task).filter(Task.external_id == external_id).first()
        if existing:
            skipped += 1
            continue

        task = Task(
            id=str(uuid.uuid4()),
            project_id=project_id,
            title=item["title"],
            description=item.get("body") or None,
            cognitive_load=2,
            estimated_minutes=60,
            source="github",
            status="backlog",
            external_id=external_id,
            created_at=datetime.utcnow(),
        )
        db.add(task)
        imported += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}
