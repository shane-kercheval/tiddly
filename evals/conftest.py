"""
Root conftest for evals — intentionally empty.

API health checks are in the MCP-specific conftest files (content_mcp/, prompt_mcp/)
since only MCP evals require a running server. AI suggestion evals call service
functions directly and only need LLM API keys in the environment.
"""
