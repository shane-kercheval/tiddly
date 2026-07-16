"""Authentication utilities for MCP server."""

from fastmcp.server.dependencies import get_http_headers

from shared.mcp_oauth import extract_bearer_token


class AuthenticationError(Exception):
    """Raised when authentication fails."""

    pass


def get_bearer_token() -> str:
    """
    Extract Bearer token from the Authorization header.

    Uses the shared :func:`extract_bearer_token` — the same parser as the 401 gate —
    so the gate can never admit a header this reader then rejects.

    Returns:
        The token string (without 'Bearer ' prefix).

    Raises:
        AuthenticationError: If no valid Bearer token is present.
    """
    headers = get_http_headers(include={"authorization"})
    token = extract_bearer_token(headers.get("authorization", ""))
    if token is None:
        raise AuthenticationError("Missing or invalid Authorization header")
    return token
