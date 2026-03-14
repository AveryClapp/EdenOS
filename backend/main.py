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
from backend.api.user_profile import router as user_profile_router
from backend.api.whoop import router as whoop_router
from backend.api.memory import router as memory_router
from backend.api.plan import router as plan_router
from backend.api.now import router as now_router
from backend.api.gcal import router as gcal_router, _sync_gcal
from backend.api.outlook import router as outlook_router, _sync_outlook
from backend.config import settings


async def _scheduler_loop() -> None:
    """Background task: re-run the scheduler and compute RL rewards every interval."""
    while True:
        await asyncio.sleep(settings.scheduler_interval_seconds)
        db = SessionLocal()
        try:
            _run_scheduler_job(db)
        except Exception as exc:
            print(f"[scheduler] background run failed: {exc}")
        finally:
            db.close()

        db = SessionLocal()
        try:
            from backend.intelligence.rl_collector import compute_rewards
            closed = compute_rewards(db)
            if closed:
                print(f"[rl] closed {closed} episode(s)")
        except Exception as exc:
            print(f"[rl] reward computation failed: {exc}")
        finally:
            db.close()


async def _sync_loop() -> None:
    """Background task: sync GCal and Outlook every interval."""
    while True:
        await asyncio.sleep(settings.sync_interval_seconds)
        for fn, label in [(_sync_gcal, "gcal"), (_sync_outlook, "outlook")]:
            db = SessionLocal()
            try:
                fn(db)
            except Exception as exc:
                print(f"[{label}] sync failed: {exc}")
            finally:
                db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    alembic_cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(alembic_cfg, "head")
    scheduler_task = asyncio.create_task(_scheduler_loop())
    sync_task = asyncio.create_task(_sync_loop())
    yield
    scheduler_task.cancel()
    sync_task.cancel()
    for t in (scheduler_task, sync_task):
        try:
            await t
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
app.include_router(user_profile_router)
app.include_router(whoop_router)
app.include_router(memory_router)
app.include_router(plan_router)
app.include_router(now_router)
app.include_router(gcal_router)
app.include_router(outlook_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
