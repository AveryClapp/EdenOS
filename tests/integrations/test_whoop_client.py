from unittest.mock import patch, MagicMock
from backend.integrations.whoop import WhoopClient


def _mock_response(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status = MagicMock()
    return mock


def test_get_auth_url():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    url = client.get_auth_url()
    assert "cid" in url
    assert "localhost" in url
    assert "read:recovery" in url


def test_exchange_code():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    mock_resp = _mock_response({
        "access_token": "acc",
        "refresh_token": "ref",
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "offline read:recovery",
    })
    with patch("httpx.post", return_value=mock_resp):
        result = client.exchange_code("authcode123")
    assert result["access_token"] == "acc"


def test_get_latest_recovery():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    client.set_tokens("acc", "ref")
    mock_resp = _mock_response({"records": [{"score": {"recovery_score": 73, "resting_heart_rate": 58, "hrv_rms_sd": 45.2}}]})
    with patch("httpx.get", return_value=mock_resp):
        result = client.get_latest_recovery()
    assert result["score"]["recovery_score"] == 73


def test_get_latest_sleep():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    client.set_tokens("acc", "ref")
    mock_resp = _mock_response({"records": [{"end": "2026-03-02T07:23:00.000Z", "score": {"sleep_performance_percentage": 82}}]})
    with patch("httpx.get", return_value=mock_resp):
        result = client.get_latest_sleep()
    assert "end" in result


def test_get_latest_cycle():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    client.set_tokens("acc", "ref")
    mock_resp = _mock_response({"records": [{"score": {"strain": 14.2}}]})
    with patch("httpx.get", return_value=mock_resp):
        result = client.get_latest_cycle()
    assert result["score"]["strain"] == 14.2
