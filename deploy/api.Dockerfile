# Backend API Dockerfile
# Build: docker build -f deploy/api.Dockerfile -t bookmarks-api .
# Run:   docker run -p 8000:8000 --env-file .env bookmarks-api

FROM python:3.13-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Set working directory
WORKDIR /app

# Copy dependency files first (for layer caching)
COPY pyproject.toml uv.lock* ./

# Install dependencies (production only, no dev dependencies)
RUN uv sync --no-dev --frozen

# Copy application code
COPY backend/src ./backend/src
COPY alembic.ini ./

# Set Python path
ENV PYTHONPATH=/app/backend/src

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the API server
CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
