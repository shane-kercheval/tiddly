"""
Shared API error parsing for MCP servers.

This module provides common error parsing logic used by both the Content MCP
and Prompt MCP servers. The parsing extracts semantic meaning from HTTP errors,
while each server handles the parsed errors according to its SDK (FastMCP vs low-level).
"""

from dataclasses import dataclass
from typing import Any, Literal

import httpx

ErrorCategory = Literal[
    "auth",              # 401 - Invalid or expired token
    "forbidden",         # 403 - Access denied
    "not_found",         # 404 - Resource not found
    "validation",        # 400/422 - Validation error
    "conflict_modified", # 409 with server_state - Optimistic locking conflict
    "conflict_name",     # 409 without server_state - Name uniqueness conflict
    "internal",          # 5xx or unexpected errors
]


@dataclass
class ParsedApiError:
    """Parsed API error with semantic category and message."""

    category: ErrorCategory
    message: str
    server_state: dict[str, Any] | None = None


def parse_http_error(
    e: httpx.HTTPStatusError,
    entity_type: str = "",
    entity_name: str = "",
) -> ParsedApiError:
    """
    Parse HTTP error into semantic categories.

    Args:
        e: The HTTP status error from httpx
        entity_type: Type of entity (e.g., "prompt", "note", "bookmark") for error messages
        entity_name: Name/ID of entity for error messages

    Returns:
        ParsedApiError with category, message, and optional server_state
    """
    status = e.response.status_code

    if status == 401:
        return ParsedApiError("auth", "Invalid or expired token")

    if status == 403:
        return ParsedApiError("forbidden", "Access denied")

    if status == 404:
        if entity_name:
            msg = f"{entity_type.title()} '{entity_name}' not found" if entity_type else f"'{entity_name}' not found"
        else:
            msg = f"{entity_type.title()} not found" if entity_type else "Not found"
        return ParsedApiError("not_found", msg)

    if status == 409:
        detail = _safe_get_detail(e)
        server_state = detail.get("server_state") if isinstance(detail, dict) else None
        if server_state:
            return ParsedApiError(
                "conflict_modified",
                "This item was modified since you loaded it. See server_state for current version.",
                server_state=server_state,
            )
        # Name conflict - extract message from detail
        if isinstance(detail, dict):
            msg = detail.get("message", "A resource with this name already exists")
        else:
            msg = "A resource with this name already exists"
        return ParsedApiError("conflict_name", msg)

    if status in (400, 422):
        return ParsedApiError("validation", _extract_validation_message(e))

    # Generic error for other status codes
    return ParsedApiError("internal", f"API error {status}")


def _safe_get_detail(e: httpx.HTTPStatusError) -> dict[str, Any] | str:
    """Safely extract detail from error response."""
    try:
        return e.response.json().get("detail", {})
    except (ValueError, KeyError):
        return {}


def _extract_validation_message(e: httpx.HTTPStatusError) -> str:
    """Extract validation error message from 400/422 response."""
    try:
        detail = e.response.json().get("detail", "Validation error")
        if isinstance(detail, dict):
            return detail.get("message", str(detail))
        if isinstance(detail, list):
            # FastAPI validation errors return a list of error objects
            messages = []
            for err in detail:
                if isinstance(err, dict):
                    loc = err.get("loc", ["unknown"])
                    field = loc[-1] if loc else "unknown"
                    msg = err.get("msg", "invalid")
                    messages.append(f"{field}: {msg}")
            return "; ".join(messages) if messages else "Validation error"
        return str(detail)
    except (ValueError, KeyError):
        return "Validation error"
