from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect
from backend.db import get_db, engine
import backend.models  # noqa: F401 — ensure all models registered

from backend.api.goals import router as goals_router
from backend.api.projects import router as projects_router
from backend.api.tasks import router as tasks_router

app = FastAPI(title="Eden", version="0.1.0")

app.include_router(goals_router)
app.include_router(projects_router)
app.include_router(tasks_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
