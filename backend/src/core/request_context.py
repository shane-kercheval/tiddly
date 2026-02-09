"""Request context types for tracking source and auth information."""
from dataclasses import dataclass
from enum import StrEnum


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

    source: str
    auth_type: AuthType
    token_prefix: str | None = None  # Only set for PAT auth, e.g. "bm_a3f8..."
