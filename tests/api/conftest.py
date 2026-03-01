import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.db import get_db


@pytest.fixture()
def client(db):
    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
