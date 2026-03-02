from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect
from backend.db import get_db, engine
import backend.models  # noqa: F401 — ensure all models registered

from backend.api.goals import router as goals_router
from backend.api.projects import router as projects_router
from backend.api.tasks import router as tasks_router
from backend.api.schedule import router as schedule_router
from backend.api.chat import router as chat_router
from backend.api.energy_profile import router as energy_profile_router
from backend.api.availability import router as availability_router

app = FastAPI(title="Eden", version="0.1.0")

app.include_router(goals_router)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(schedule_router)
app.include_router(chat_router)
app.include_router(energy_profile_router)
app.include_router(availability_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
