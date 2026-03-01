from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_health_check_still_passes():
    response = client.get("/health")
    assert response.status_code == 200


def test_db_info_endpoint():
    response = client.get("/db-info")
    assert response.status_code == 200
    data = response.json()
    assert "tables" in data
    assert "goals" in data["tables"]
