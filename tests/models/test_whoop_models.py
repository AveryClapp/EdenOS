import uuid
from datetime import datetime, date
from backend.models.whoop_token import WhoopToken
from backend.models.whoop_daily import WhoopDaily


def test_whoop_token_model(db):
    token = WhoopToken(
        id=str(uuid.uuid4()),
        access_token="tok_abc",
        refresh_token="ref_xyz",
        token_type="Bearer",
        expires_at=datetime(2026, 6, 1, 12, 0),
        scope="offline read:recovery",
    )
    db.add(token)
    db.commit()
    fetched = db.get(WhoopToken, token.id)
    assert fetched.access_token == "tok_abc"


def test_whoop_daily_model(db):
    daily = WhoopDaily(
        id=str(uuid.uuid4()),
        date=date(2026, 3, 2),
        recovery_score=73,
        hrv_rms=45.2,
        resting_hr=58,
        sleep_quality_score=82,
        strain_score=8.4,
        synced_at=datetime.utcnow(),
    )
    db.add(daily)
    db.commit()
    fetched = db.get(WhoopDaily, daily.id)
    assert fetched.recovery_score == 73
    assert fetched.strain_score == 8.4
