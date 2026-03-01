import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.db import Base
import backend.models.goal  # noqa: F401 — registers with Base.metadata
import backend.models.project  # noqa: F401
import backend.models.task  # noqa: F401
import backend.models.energy_profile  # noqa: F401


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)
