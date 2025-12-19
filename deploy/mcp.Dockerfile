# MCP Server Dockerfile
# Build: docker build -f deploy/mcp.Dockerfile -t bookmarks-mcp .
# Run:   docker run -p 8001:8001 --env-file .env bookmarks-mcp

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

# Set Python path
ENV PYTHONPATH=/app/backend/src

# Expose port
EXPOSE 8001

# Health check (MCP server responds to HTTP)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Run the MCP server
CMD ["uv", "run", "python", "-m", "mcp_server"]
