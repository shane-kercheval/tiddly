"""Request context types for tracking source and auth information."""
from dataclasses import dataclass
from enum import StrEnum


class RequestSource(StrEnum):
    """Source of the API request, determined by X-Request-Source header."""

    WEB = "web"
    API = "api"
    MCP_CONTENT = "mcp-content"
    MCP_PROMPT = "mcp-prompt"
    UNKNOWN = "unknown"  # Default when header missing/unrecognized


class AuthType(StrEnum):
    """Authentication method used for the request."""

    AUTH0 = "auth0"
    PAT = "pat"
    DEV = "dev"


@dataclass
class RequestContext:
    """
    Context information for tracking the source and auth type of a request.

    Used for audit trails in history recording.
    """

    source: RequestSource
    auth_type: AuthType
    token_prefix: str | None = None  # Only set for PAT auth, e.g. "bm_a3f8..."
