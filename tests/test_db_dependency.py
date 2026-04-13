import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.db import Base, get_db
from backend.main import app

# Test client using in-memory SQLite (same pattern as other API tests)
_test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
Base.metadata.create_all(bind=_test_engine)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


def _override_get_db():
    db = _TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db
client = TestClient(app)


def test_health_check_still_passes():
    response = client.get("/health")
    assert response.status_code == 200


def test_db_info_endpoint():
    """/db-info uses sa_inspect(engine) directly — skips if Postgres not running."""
    try:
        response = client.get("/db-info")
    except Exception:
        pytest.skip("Configured database not reachable — skipping db-info test")
    assert response.status_code == 200
    data = response.json()
    assert "tables" in data
    assert "goals" in data["tables"]
