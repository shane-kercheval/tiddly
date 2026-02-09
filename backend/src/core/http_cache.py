"""HTTP caching utilities for ETag and Last-Modified support."""
import hashlib
from datetime import datetime, UTC
from email.utils import formatdate, parsedate_to_datetime

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint


# Headers for cacheable responses
CACHE_HEADERS = {
    "Cache-Control": "private, must-revalidate",
    "Vary": "Authorization",
}


def generate_etag(content: bytes) -> str:
    """
    Generate weak ETag from response content.

    Uses MD5 for speed - this is content fingerprinting, not cryptographic security.
    Weak ETags (W/ prefix) indicate semantic equivalence, not byte-for-byte identity.
    """
    hash_value = hashlib.md5(content).hexdigest()[:16]
    return f'W/"{hash_value}"'


def _parse_if_none_match(header_value: str) -> list[str]:
    """
    Parse If-None-Match header value into list of ETags.

    Handles:
    - Single ETag: 'W/"abc123"' -> ['W/"abc123"']
    - Comma-separated: 'W/"abc", W/"def"' -> ['W/"abc"', 'W/"def"']
    - Wildcard: '*' -> ['*']
    """
    if not header_value:
        return []
    # Handle wildcard
    if header_value.strip() == "*":
        return ["*"]
    # Split by comma and strip whitespace
    return [etag.strip() for etag in header_value.split(",") if etag.strip()]


def _etag_matches(etag: str, if_none_match_values: list[str]) -> bool:
    """
    Check if ETag matches any value in If-None-Match list.

    Per RFC 7232, weak comparison is used for If-None-Match:
    - Wildcard '*' matches any ETag
    - Otherwise, compare ETag values (weak ETags match if quoted values are equal)
    """
    if "*" in if_none_match_values:
        return True
    return etag in if_none_match_values


class ETagMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds ETag headers to GET JSON responses.

    Automatically generates ETags for all GET requests returning JSON, and returns
    304 Not Modified when the client's If-None-Match header matches the current ETag.

    This saves bandwidth on unchanged responses, though the server still performs
    the full database query and JSON serialization to compute the ETag hash.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint,
    ) -> Response:
        """Process request and add ETag header to response."""
        # Skip non-GET requests
        if request.method != "GET":
            return await call_next(request)

        response = await call_next(request)

        # Skip non-JSON or error responses
        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type or response.status_code >= 400:
            return response

        # Read response body and generate ETag
        body = b"".join([chunk async for chunk in response.body_iterator])
        etag = generate_etag(body)

        # Check If-None-Match header (supports comma-separated lists and wildcard *)
        if_none_match = request.headers.get("if-none-match")
        if if_none_match:
            if_none_match_values = _parse_if_none_match(if_none_match)
            if _etag_matches(etag, if_none_match_values):
                # Return 304 with caching headers (security headers added by outer middleware)
                return Response(
                    status_code=304,
                    headers={"ETag": etag, **CACHE_HEADERS},
                )

        # Build new response with ETag and caching headers
        # Preserve original headers (rate limit, etc.) and add our caching headers
        headers = dict(response.headers)
        headers["ETag"] = etag
        headers.update(CACHE_HEADERS)

        return Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
            media_type=response.media_type,
        )


def format_http_date(dt: datetime) -> str:
    """
    Format datetime as HTTP date (RFC 7231).

    Example: "Wed, 15 Jan 2026 10:30:00 GMT"

    Handles both timezone-aware and naive datetimes. Naive datetimes are
    assumed to be UTC (consistent with how PostgreSQL TIMESTAMP WITH TIME ZONE
    values are returned when the session timezone is UTC).
    """
    # Normalize naive datetimes to UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    # Convert to UTC timestamp, then format as HTTP date
    timestamp = dt.timestamp()
    return formatdate(timestamp, usegmt=True)


def parse_http_date(date_str: str) -> datetime | None:
    """
    Parse HTTP date string to datetime.

    Handles RFC 7231 format: "Wed, 15 Jan 2026 10:30:00 GMT"
    Returns None if parsing fails.
    """
    try:
        return parsedate_to_datetime(date_str)
    except (ValueError, TypeError):
        return None


def check_not_modified(request: Request, updated_at: datetime) -> Response | None:
    """
    Check If-Modified-Since header and return 304 response if not modified.

    Returns None if request should proceed with full response.
    Skips check if If-None-Match is present (ETag takes precedence per HTTP spec).

    Args:
        request: The incoming request to check headers on
        updated_at: The resource's last modification timestamp

    Returns:
        Response with 304 status if not modified, None otherwise
    """
    # ETag takes precedence - let middleware handle it
    if request.headers.get("if-none-match"):
        return None

    if_modified_since = request.headers.get("if-modified-since")
    if not if_modified_since:
        return None

    client_date = parse_http_date(if_modified_since)
    if client_date is None:
        return None

    # Ensure updated_at is timezone-aware for comparison
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=UTC)

    # Compare timestamps (truncate to seconds for HTTP date precision)
    # HTTP dates only have second precision, so we compare at that level
    updated_at_seconds = updated_at.replace(microsecond=0)
    client_date_seconds = client_date.replace(microsecond=0)

    if updated_at_seconds <= client_date_seconds:
        # Resource not modified since client's cached version
        return Response(
            status_code=304,
            headers={
                "Last-Modified": format_http_date(updated_at),
                **CACHE_HEADERS,
            },
        )

    return None
