import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect
from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command

from backend.db import get_db, engine, SessionLocal
import backend.models  # noqa: F401 — ensure all models registered

from backend.api.goals import router as goals_router
from backend.api.projects import router as projects_router
from backend.api.tasks import router as tasks_router
from backend.api.schedule import router as schedule_router, _run_scheduler_job
from backend.api.chat import router as chat_router
from backend.api.energy_profile import router as energy_profile_router
from backend.api.availability import router as availability_router
from backend.api.github import router as github_router
from backend.config import settings


async def _scheduler_loop() -> None:
    """Background task: re-run the scheduler every SCHEDULER_INTERVAL_SECONDS."""
    while True:
        await asyncio.sleep(settings.scheduler_interval_seconds)
        db = SessionLocal()
        try:
            _run_scheduler_job(db)
        except Exception as exc:
            print(f"[scheduler] background run failed: {exc}")
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    alembic_cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(alembic_cfg, "head")
    task = asyncio.create_task(_scheduler_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Eden", version="0.1.0", lifespan=lifespan)

app.include_router(goals_router)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(schedule_router)
app.include_router(chat_router)
app.include_router(energy_profile_router)
app.include_router(availability_router)
app.include_router(github_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
