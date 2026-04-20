# Backend container for Denial Review Workbench
#
# Architecture constraints preserved:
# - Single uvicorn worker (state.py is not thread-safe)
# - Writable data/runs/ for JSONL append (mount a persistent volume)
# - No --reload in production
#
# Build:  docker build -t denial-review-workbench .
# Run:    docker run -p 8000:8000 -e ANTHROPIC_API_KEY=sk-ant-... denial-review-workbench
# Health: curl http://localhost:8000/health

FROM python:3.13-slim

WORKDIR /app

# Install runtime dependencies only (no test deps needed in container)
COPY requirements.txt .
RUN pip install --no-cache-dir \
    fastapi uvicorn pydantic anthropic

# Copy backend code and data
COPY backend/ backend/
COPY data/ data/

# data/runs/ must be writable for JSONL append.
# Mount a persistent volume here to survive container restarts.
# If no volume is mounted, run data is lost on restart.
RUN mkdir -p data/runs

EXPOSE 8000

# Single worker only. Do not add --workers flag.
# The in-memory state dict is not shared across workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "backend"]
