from backend.db import Base, engine


def test_base_exists():
    assert Base is not None


def test_engine_connects():
    with engine.connect() as conn:
        assert conn is not None
