set dotenv-load

# Start both backend and frontend (opens http://localhost:5173)
start:
    #!/usr/bin/env bash
    trap 'kill $(jobs -p) 2>/dev/null' EXIT
    source .venv/bin/activate
    uvicorn backend.main:app --reload --port 8500 &
    cd frontend && npm run dev &
    wait

# Start backend only (API on http://localhost:8500)
backend:
    source .venv/bin/activate && uvicorn backend.main:app --reload --port 8500

# Start frontend only (UI on http://localhost:5173)
frontend:
    cd frontend && npm run dev

# Stop all running Eden processes
stop:
    -pkill -f "uvicorn backend.main:app"
    -pkill -f "vite"
    @echo "stopped"

# Run tests
test:
    source .venv/bin/activate && pytest tests/ -q

# Run database migrations
migrate:
    source .venv/bin/activate && alembic upgrade head
