import uuid
from datetime import datetime, timedelta, date, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.config import settings
from backend.models.whoop_token import WhoopToken
from backend.models.whoop_daily import WhoopDaily
from backend.integrations.whoop import WhoopClient

router = APIRouter(prefix="/api/whoop", tags=["whoop"])


def _get_client() -> WhoopClient:
    return WhoopClient(
        client_id=settings.whoop_client_id,
        client_secret=settings.whoop_client_secret,
        redirect_uri=settings.whoop_redirect_uri,
    )


@router.get("/status")
def whoop_status(db: Session = Depends(get_db)):
    token = db.query(WhoopToken).first()
    if not token:
        return {"connected": False, "today": None}

    today = date.today()
    daily = db.query(WhoopDaily).filter(WhoopDaily.date == today).first()
    today_data = None
    if daily:
        today_data = {
            "recovery_score": daily.recovery_score,
            "hrv_rms": daily.hrv_rms,
            "resting_hr": daily.resting_hr,
            "sleep_quality_score": daily.sleep_quality_score,
            "strain_score": daily.strain_score,
            "actual_wake_time": daily.actual_wake_time.isoformat() if daily.actual_wake_time else None,
            "synced_at": daily.synced_at.isoformat(),
        }
    return {"connected": True, "today": today_data}


@router.get("/connect")
def whoop_connect():
    client = _get_client()
    return RedirectResponse(url=client.get_auth_url())


@router.get("/callback")
def whoop_callback(code: str, db: Session = Depends(get_db)):
    client = _get_client()
    try:
        token_data = client.exchange_code(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {e}")

    expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))

    # Upsert — only one token row
    token = db.query(WhoopToken).first()
    if token:
        token.access_token = token_data["access_token"]
        token.refresh_token = token_data.get("refresh_token", token.refresh_token)
        token.expires_at = expires_at
        token.scope = token_data.get("scope", "")
    else:
        token = WhoopToken(
            id=str(uuid.uuid4()),
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token", ""),
            token_type=token_data.get("token_type", "Bearer"),
            expires_at=expires_at,
            scope=token_data.get("scope", ""),
        )
        db.add(token)
    db.commit()

    # Redirect to frontend after successful connect
    return RedirectResponse(url="http://localhost:5173/?whoop=connected")


@router.post("/sync")
def whoop_sync(db: Session = Depends(get_db)):
    token = db.query(WhoopToken).first()
    if not token:
        raise HTTPException(status_code=400, detail="Whoop not connected. Visit /api/whoop/connect first.")

    client = _get_client()
    client.set_tokens(token.access_token, token.refresh_token)

    recovery = client.get_latest_recovery()
    sleep = client.get_latest_sleep()
    cycle = client.get_latest_cycle()

    today = date.today()

    recovery_score = None
    hrv_rms = None
    resting_hr = None
    if recovery:
        score = recovery.get("score", {})
        recovery_score = score.get("recovery_score")
        hrv_rms = score.get("hrv_rms_sd")
        resting_hr = score.get("resting_heart_rate")

    sleep_quality_score = None
    actual_wake_time = None
    if sleep:
        score = sleep.get("score", {})
        sleep_quality_score = score.get("sleep_performance_percentage")
        end_str = sleep.get("end")
        if end_str:
            try:
                actual_wake_time = datetime.fromisoformat(end_str.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                pass

    strain_score = None
    if cycle:
        score = cycle.get("score", {})
        strain_score = score.get("strain")

    # Upsert WhoopDaily for today
    daily = db.query(WhoopDaily).filter(WhoopDaily.date == today).first()
    if daily:
        daily.recovery_score = recovery_score
        daily.hrv_rms = hrv_rms
        daily.resting_hr = resting_hr
        daily.sleep_quality_score = sleep_quality_score
        daily.actual_wake_time = actual_wake_time
        daily.strain_score = strain_score
        daily.synced_at = datetime.utcnow()
    else:
        daily = WhoopDaily(
            id=str(uuid.uuid4()),
            date=today,
            recovery_score=recovery_score,
            hrv_rms=hrv_rms,
            resting_hr=resting_hr,
            sleep_quality_score=sleep_quality_score,
            actual_wake_time=actual_wake_time,
            strain_score=strain_score,
            synced_at=datetime.utcnow(),
        )
        db.add(daily)
    db.commit()
    db.refresh(daily)

    # Adaptive rescheduling: if recovery is below green threshold, re-run the
    # scheduler so it applies the reduced recovery_multiplier to today's plan.
    if daily.recovery_score is not None and daily.recovery_score < 67:
        try:
            from backend.api.schedule import _run_scheduler_job
            _run_scheduler_job(db)
        except Exception as exc:
            print(f"[whoop] adaptive reschedule failed: {exc}")

    return {
        "recovery_score": daily.recovery_score,
        "hrv_rms": daily.hrv_rms,
        "resting_hr": daily.resting_hr,
        "sleep_quality_score": daily.sleep_quality_score,
        "strain_score": daily.strain_score,
        "actual_wake_time": daily.actual_wake_time.isoformat() if daily.actual_wake_time else None,
        "synced_at": daily.synced_at.isoformat(),
        "schedule_adapted": daily.recovery_score is not None and daily.recovery_score < 67,
    }
