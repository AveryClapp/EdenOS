import pytest
from backend.db import Base, engine


def test_base_exists():
    assert Base is not None


def test_engine_connects():
    """Skips if the configured database isn't reachable (e.g. Postgres not running locally)."""
    try:
        with engine.connect() as conn:
            assert conn is not None
    except Exception:
        pytest.skip("Configured database not reachable — skipping connection test")
