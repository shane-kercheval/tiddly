"""Entry point for running the Prompt MCP server."""

import os

import uvicorn

if __name__ == "__main__":
    host = os.getenv("PROMPT_MCP_HOST", "0.0.0.0")
    # PROMPT_MCP_PORT for local dev, PORT for PaaS platforms (Railway, Heroku, etc.)
    port = int(os.getenv("PROMPT_MCP_PORT") or os.getenv("PORT") or "8002")

    uvicorn.run(
        "prompt_mcp_server.main:app",
        host=host,
        port=port,
        log_level="info",
    )
