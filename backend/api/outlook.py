import uuid
from datetime import datetime, timedelta, date, time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.config import settings
from backend.models.outlook_token import OutlookToken
from backend.models.schedule_block import ScheduleBlock
from backend.models.task import Task
from backend.integrations.outlook import OutlookClient

router = APIRouter(prefix="/api/outlook", tags=["outlook"])


def _get_client() -> OutlookClient:
    return OutlookClient(
        client_id=settings.ms_client_id,
        client_secret=settings.ms_client_secret,
        tenant_id=settings.ms_tenant_id,
        redirect_uri=settings.ms_redirect_uri,
    )


def _ensure_fresh_token(token: OutlookToken, db: Session) -> OutlookClient:
    """Return an authenticated client, refreshing the token if needed."""
    client = _get_client()
    if datetime.utcnow() + timedelta(minutes=5) >= token.expires_at:
        try:
            refreshed = client.refresh_access_token(token.refresh_token)
            token.access_token = refreshed["access_token"]
            token.expires_at = datetime.utcnow() + timedelta(seconds=refreshed.get("expires_in", 3600))
            if "refresh_token" in refreshed:
                token.refresh_token = refreshed["refresh_token"]
            db.commit()
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Outlook token refresh failed: {e}")
    client.set_tokens(token.access_token, token.refresh_token)
    return client


def _sync_outlook(db: Session) -> dict:
    """
    Core sync logic — callable from route handler and background loop.
    Returns {imported, exported, deleted}.
    """
    token = db.query(OutlookToken).first()
    if not token:
        return {"imported": 0, "exported": 0, "deleted": 0}

    client = _ensure_fresh_token(token, db)

    today = date.today()
    time_min = datetime.combine(today, time.min)
    time_max = datetime.combine(today + timedelta(days=7), time.min)

    events = client.get_events(time_min, time_max)
    fetched_ids = {e["id"] for e in events}

    imported = 0
    for event in events:
        start_str = event.get("start", {}).get("dateTime")
        end_str = event.get("end", {}).get("dateTime")
        if not start_str or not end_str:
            continue

        start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00")).replace(tzinfo=None)
        end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00")).replace(tzinfo=None)
        event_date = start_dt.date()
        event_id = event["id"]
        label = event.get("subject", "")

        existing = db.query(ScheduleBlock).filter(
            ScheduleBlock.calendar_event_id == event_id
        ).first()

        if existing:
            existing.date = event_date
            existing.start_time = start_dt.time()
            existing.end_time = end_dt.time()
            existing.label = label
        else:
            db.add(ScheduleBlock(
                id=str(uuid.uuid4()),
                task_id=None,
                calendar_event_id=event_id,
                date=event_date,
                start_time=start_dt.time(),
                end_time=end_dt.time(),
                label=label,
                auto_generated=False,
                overridden_by_user=False,
            ))
            imported += 1

    # Delete blocks for events that no longer exist
    stale = db.query(ScheduleBlock).filter(
        ScheduleBlock.calendar_event_id.isnot(None),
        ScheduleBlock.task_id.is_(None),
    ).all()
    deleted = 0
    for block in stale:
        if block.calendar_event_id not in fetched_ids:
            db.delete(block)
            deleted += 1

    db.commit()

    # Export Eden blocks back to Outlook
    eden_blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.auto_generated == True,
        ScheduleBlock.task_id.isnot(None),
        ScheduleBlock.calendar_event_id.is_(None),
        ScheduleBlock.date >= today,
        ScheduleBlock.date < today + timedelta(days=7),
    ).all()

    exported = 0
    for block in eden_blocks:
        task = db.get(Task, block.task_id)
        if not task:
            continue
        start_dt = datetime.combine(block.date, block.start_time)
        end_dt = datetime.combine(block.date, block.end_time)
        try:
            event = client.create_event(task.title, start_dt, end_dt)
            block.calendar_event_id = event["id"]
            exported += 1
        except Exception:
            pass  # Best-effort export

    db.commit()
    return {"imported": imported, "exported": exported, "deleted": deleted}


@router.get("/status")
def outlook_status(db: Session = Depends(get_db)):
    token = db.query(OutlookToken).first()
    return {"connected": token is not None}


@router.get("/connect")
def outlook_connect():
    client = _get_client()
    return RedirectResponse(url=client.get_auth_url())


@router.get("/callback")
def outlook_callback(code: str, db: Session = Depends(get_db)):
    client = _get_client()
    try:
        token_data = client.exchange_code(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {e}")

    expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))

    token = db.query(OutlookToken).first()
    if token:
        token.access_token = token_data["access_token"]
        token.refresh_token = token_data.get("refresh_token", token.refresh_token)
        token.expires_at = expires_at
        token.scope = token_data.get("scope", "")
    else:
        token = OutlookToken(
            id=str(uuid.uuid4()),
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token", ""),
            token_type=token_data.get("token_type", "Bearer"),
            expires_at=expires_at,
            scope=token_data.get("scope", ""),
        )
        db.add(token)
    db.commit()

    return RedirectResponse(url="http://localhost:5173/?outlook=connected")


@router.post("/sync")
def outlook_sync(db: Session = Depends(get_db)):
    token = db.query(OutlookToken).first()
    if not token:
        raise HTTPException(status_code=400, detail="Outlook not connected. Visit /api/outlook/connect first.")
    return _sync_outlook(db)
