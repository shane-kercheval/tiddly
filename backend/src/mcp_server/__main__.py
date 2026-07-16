"""Entry point for running the MCP server."""

import os

import uvicorn

if __name__ == "__main__":
    host = os.getenv("MCP_HOST", "0.0.0.0")
    # MCP_PORT for local dev (.env), PORT for PaaS platforms (Railway, Heroku, etc.)
    port = int(os.getenv("MCP_PORT") or os.getenv("PORT") or "8001")
    # Serve the Starlette ASGI app (FastMCP http_app + OAuth gate/CORS/transport
    # security) rather than mcp.run(), which has no ASGI layer for the auth gating.
    uvicorn.run("mcp_server.app:app", host=host, port=port, log_level="info")
