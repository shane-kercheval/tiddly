"""
Rate limiting configuration and types.

This module contains types and utilities for rate limiting.
Rate limit values are defined in TierLimits (tier_limits.py).
Enforcement logic is in rate_limiter.py.

To adjust rate limits, modify TierLimits in tier_limits.py.
To add new sensitive endpoints, add them to SENSITIVE_ENDPOINTS below.
"""
from dataclasses import dataclass
from enum import Enum


class OperationType(Enum):
    """Operation type for rate limiting."""

    READ = "read"
    WRITE = "write"
    SENSITIVE = "sensitive"  # External HTTP calls, AI/LLM, bulk operations


@dataclass
class RateLimitConfig:
    """Rate limit configuration for an operation type."""

    requests_per_minute: int
    requests_per_day: int


@dataclass
class RateLimitResult:
    """Result of a rate limit check with all info needed for headers."""

    allowed: bool
    limit: int  # Max requests in current window
    remaining: int  # Requests remaining in current window
    reset: int  # Unix timestamp when window resets
    retry_after: int  # Seconds until retry allowed (0 if allowed)


class RateLimitExceededError(Exception):
    """Raised when rate limit is exceeded."""

    def __init__(self, result: RateLimitResult) -> None:
        self.result = result
        super().__init__("Rate limit exceeded")


# ---------------------------------------------------------------------------
# Sensitive Endpoints
# ---------------------------------------------------------------------------
# Endpoints that make external HTTP requests or are resource-intensive.
# These get stricter rate limits and are blocked for PAT auth.
# Format: (HTTP_METHOD, path_without_query_params)

SENSITIVE_ENDPOINTS: set[tuple[str, str]] = {
    ("GET", "/bookmarks/fetch-metadata"),
    # Future: AI/LLM endpoints, bulk import/export
}


def get_operation_type(method: str, path: str) -> OperationType:
    """Determine operation type from HTTP method and path."""
    if (method, path) in SENSITIVE_ENDPOINTS:
        return OperationType.SENSITIVE
    if method == "GET":
        return OperationType.READ
    return OperationType.WRITE
