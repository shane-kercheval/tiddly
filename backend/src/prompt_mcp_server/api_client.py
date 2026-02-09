"""HTTP client helpers for forwarding requests to the Bookmarks API."""

import os
from typing import Any

import httpx


def get_api_base_url() -> str:
    """Get the API base URL from environment."""
    return os.getenv("VITE_API_URL", "http://localhost:8000")


def get_default_timeout() -> float:
    """Get the default request timeout."""
    return float(os.getenv("MCP_API_TIMEOUT", "30.0"))


def _get_headers(token: str) -> dict[str, str]:
    """Get common headers for API requests."""
    return {
        "Authorization": f"Bearer {token}",
        "X-Request-Source": "mcp-prompt",
    }


async def api_get(
    client: httpx.AsyncClient,
    path: str,
    token: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Make an authenticated GET request to the API."""
    response = await client.get(
        path,
        params=params,
        headers=_get_headers(token),
    )
    response.raise_for_status()
    return response.json()


async def api_post(
    client: httpx.AsyncClient,
    path: str,
    token: str,
    json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Make an authenticated POST request to the API."""
    response = await client.post(
        path,
        json=json,
        headers=_get_headers(token),
    )
    response.raise_for_status()
    return response.json()


async def api_patch(
    client: httpx.AsyncClient,
    path: str,
    token: str,
    json: dict[str, Any],
) -> dict[str, Any]:
    """Make an authenticated PATCH request to the API."""
    response = await client.patch(
        path,
        json=json,
        headers=_get_headers(token),
    )
    response.raise_for_status()
    return response.json()
