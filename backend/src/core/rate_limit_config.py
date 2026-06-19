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
    SENSITIVE = "sensitive"  # External HTTP calls, bulk operations
    AI_PLATFORM = "ai_platform"  # AI endpoints using platform API key
    AI_BYOK = "ai_byok"  # AI endpoints using user's own API key


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
    # Future: bulk import/export (AI/LLM has its own rate limit types in Milestone 1b)
}


# ---------------------------------------------------------------------------
# Public (unauthenticated) endpoints
# ---------------------------------------------------------------------------
# The /public/* share endpoints have no user context, so they can't use the
# tier-based per-user limits above; they're rate-limited per client IP instead.
# These are abuse/DoS protection only — the 256-bit share token already makes
# enumeration infeasible, so the caps are generous to avoid throttling
# legitimate viewers behind a shared egress IP (corporate NAT, campus gateway)
# who all hit the same popular link.
#
# Note: public responses use `max-age=0, must-revalidate`, so every view —
# including 304 cache revalidations — runs the route and consumes one token
# (ETagMiddleware computes the ETag after executing the handler). The per-minute
# cap is therefore the binding constraint for a burst of NAT'd viewers, which is
# why it is set higher than a naive "humans per minute" estimate.
PUBLIC_IP_RATE_LIMIT_PER_MINUTE = 60
PUBLIC_IP_RATE_LIMIT_PER_DAY = 2000


def get_operation_type(method: str, path: str) -> OperationType:
    """Determine operation type from HTTP method and path."""
    if (method, path) in SENSITIVE_ENDPOINTS:
        return OperationType.SENSITIVE
    if method == "GET":
        return OperationType.READ
    return OperationType.WRITE
