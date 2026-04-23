"""
Pytest configuration for Content MCP server evaluations.

Requires a running API server — fails fast if not available.
"""
import httpx

API_BASE_URL = "http://localhost:8000"


def check_api_health() -> None:
    """Check if the API server is healthy. Raises exception if not."""
    try:
        response = httpx.get(f"{API_BASE_URL}/health", timeout=5)
        response.raise_for_status()
    except httpx.ConnectError as e:
        raise RuntimeError(
            f"Cannot connect to API server at {API_BASE_URL}. "
            "Make sure 'make api-run' is running.",
        ) from e
    except Exception as e:
        raise RuntimeError(
            f"API health check failed: {e}. "
            "Make sure 'make api-run' is running.",
        ) from e


check_api_health()
