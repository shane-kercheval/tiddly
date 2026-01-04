"""
Authentication utilities for Prompt MCP server.

Uses Python contextvars for request-scoped token storage.
The token is set by ASGI middleware before MCP dispatch and
accessed by MCP handlers to authenticate API requests.
"""

from contextvars import ContextVar


class AuthenticationError(Exception):
    """Raised when authentication fails."""

    pass


# Request-scoped token storage
_current_token: ContextVar[str | None] = ContextVar("current_token", default=None)


def set_current_token(token: str) -> None:
    """
    Set the Bearer token for the current request context.

    Called by ASGI middleware before MCP dispatch.

    Args:
        token: The Bearer token (without 'Bearer ' prefix).
    """
    _current_token.set(token)


def get_bearer_token() -> str:
    """
    Get the Bearer token from the current request context.

    Called by MCP handlers to authenticate API requests.

    Returns:
        The token string.

    Raises:
        AuthenticationError: If no token is present in context.
    """
    token = _current_token.get()
    if not token:
        raise AuthenticationError("No authentication token in context")
    return token


def clear_current_token() -> None:
    """
    Clear the token after request completes.

    Called by ASGI middleware in finally block.
    """
    _current_token.set(None)
