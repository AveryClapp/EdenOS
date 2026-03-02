from unittest.mock import patch, MagicMock


def test_whoop_status_not_connected(client):
    r = client.get("/api/whoop/status")
    assert r.status_code == 200
    assert r.json()["connected"] is False
    assert r.json()["today"] is None


def test_whoop_connect_redirects(client):
    r = client.get("/api/whoop/connect", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "whoop.com" in r.headers.get("location", "")


def test_whoop_sync_no_token(client):
    r = client.post("/api/whoop/sync")
    assert r.status_code == 400


def test_whoop_sync_with_token(client, db):
    from datetime import datetime, timedelta
    import uuid
    from backend.models.whoop_token import WhoopToken

    token = WhoopToken(
        id=str(uuid.uuid4()),
        access_token="test_access",
        refresh_token="test_refresh",
        token_type="Bearer",
        expires_at=datetime.utcnow() + timedelta(hours=1),
        scope="offline read:recovery",
    )
    db.add(token)
    db.commit()

    mock_recovery = {"score": {"recovery_score": 73, "resting_heart_rate": 58, "hrv_rms_sd": 45.2}}
    mock_sleep = {"end": "2026-03-02T07:23:00.000Z", "score": {"sleep_performance_percentage": 82}}
    mock_cycle = {"score": {"strain": 8.4}}

    with patch("backend.api.whoop.WhoopClient") as MockClient:
        mock_instance = MagicMock()
        MockClient.return_value = mock_instance
        mock_instance.get_latest_recovery.return_value = mock_recovery
        mock_instance.get_latest_sleep.return_value = mock_sleep
        mock_instance.get_latest_cycle.return_value = mock_cycle

        r = client.post("/api/whoop/sync")

    assert r.status_code == 200
    data = r.json()
    assert data["recovery_score"] == 73
