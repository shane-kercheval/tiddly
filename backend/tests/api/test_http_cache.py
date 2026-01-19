"""Tests for HTTP caching (ETag middleware and Last-Modified)."""
from datetime import datetime, UTC
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient

from core.http_cache import (
    check_not_modified,
    format_http_date,
    generate_etag,
    parse_http_date,
)


class TestGenerateEtag:
    """Tests for ETag generation function."""

    def test__generate_etag__same_content_same_etag(self) -> None:
        """Same content should produce identical ETags."""
        content = b'{"id": "123", "name": "test"}'
        etag1 = generate_etag(content)
        etag2 = generate_etag(content)
        assert etag1 == etag2

    def test__generate_etag__different_content_different_etag(self) -> None:
        """Different content should produce different ETags."""
        content1 = b'{"id": "123", "name": "test"}'
        content2 = b'{"id": "456", "name": "other"}'
        etag1 = generate_etag(content1)
        etag2 = generate_etag(content2)
        assert etag1 != etag2

    def test__generate_etag__weak_etag_format(self) -> None:
        """ETag should be weak (W/ prefix) and quoted."""
        content = b'{"data": "test"}'
        etag = generate_etag(content)
        assert etag.startswith('W/"')
        assert etag.endswith('"')
        # Should be 16 hex chars between quotes
        inner = etag[3:-1]  # Remove W/" and "
        assert len(inner) == 16
        assert all(c in "0123456789abcdef" for c in inner)

    def test__generate_etag__empty_content(self) -> None:
        """Empty content should still produce valid ETag."""
        etag = generate_etag(b"")
        assert etag.startswith('W/"')
        assert etag.endswith('"')


class TestETagMiddleware:
    """Tests for ETag middleware behavior."""

    @pytest.mark.asyncio
    async def test__etag_middleware__get_request_receives_etag(
        self, client: AsyncClient,
    ) -> None:
        """GET request should receive ETag header in response."""
        response = await client.get("/health")
        assert response.status_code == 200
        assert "etag" in response.headers
        assert response.headers["etag"].startswith('W/"')

    @pytest.mark.asyncio
    async def test__etag_middleware__matching_if_none_match_returns_304(
        self, client: AsyncClient,
    ) -> None:
        """GET with matching If-None-Match should return 304."""
        # First request to get ETag
        response1 = await client.get("/health")
        assert response1.status_code == 200
        etag = response1.headers["etag"]

        # Second request with If-None-Match
        response2 = await client.get("/health", headers={"If-None-Match": etag})
        assert response2.status_code == 304
        assert response2.content == b""  # No body on 304

    @pytest.mark.asyncio
    async def test__etag_middleware__non_matching_if_none_match_returns_200(
        self, client: AsyncClient,
    ) -> None:
        """GET with non-matching If-None-Match should return 200 with new ETag."""
        response = await client.get(
            "/health",
            headers={"If-None-Match": 'W/"nonexistent1234"'},
        )
        assert response.status_code == 200
        assert "etag" in response.headers

    @pytest.mark.asyncio
    async def test__etag_middleware__post_request_no_etag(
        self, client: AsyncClient,
    ) -> None:
        """POST request should not receive ETag header."""
        response = await client.post(
            "/bookmarks/",
            json={"url": "https://example.com", "title": "Test"},
        )
        assert response.status_code == 201
        assert "etag" not in response.headers

    @pytest.mark.asyncio
    async def test__etag_middleware__error_response_no_etag(
        self, client: AsyncClient,
    ) -> None:
        """Error responses should not receive ETag header."""
        response = await client.get("/bookmarks/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404
        assert "etag" not in response.headers


class TestCachingHeaders:
    """Tests for Cache-Control and Vary headers."""

    @pytest.mark.asyncio
    async def test__caching_headers__present_on_200_response(
        self, client: AsyncClient,
    ) -> None:
        """200 response should include Cache-Control and Vary headers."""
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.headers.get("cache-control") == "private, must-revalidate"
        assert response.headers.get("vary") == "Authorization"

    @pytest.mark.asyncio
    async def test__caching_headers__present_on_304_response(
        self, client: AsyncClient,
    ) -> None:
        """304 response should include Cache-Control and Vary headers."""
        # Get ETag first
        response1 = await client.get("/health")
        etag = response1.headers["etag"]

        # Request with matching ETag
        response2 = await client.get("/health", headers={"If-None-Match": etag})
        assert response2.status_code == 304
        assert response2.headers.get("cache-control") == "private, must-revalidate"
        assert response2.headers.get("vary") == "Authorization"

    @pytest.mark.asyncio
    async def test__caching_headers__etag_present_on_304(
        self, client: AsyncClient,
    ) -> None:
        """304 response should include ETag header."""
        response1 = await client.get("/health")
        etag = response1.headers["etag"]

        response2 = await client.get("/health", headers={"If-None-Match": etag})
        assert response2.status_code == 304
        assert response2.headers.get("etag") == etag


class TestSecurityHeadersOn304:
    """Tests to verify security headers are present on 304 responses."""

    @pytest.mark.asyncio
    async def test__security_headers__present_on_304_response(
        self, client: AsyncClient,
    ) -> None:
        """304 response should include security headers from SecurityHeadersMiddleware."""
        # Get ETag first
        response1 = await client.get("/health")
        etag = response1.headers["etag"]

        # Request with matching ETag
        response2 = await client.get("/health", headers={"If-None-Match": etag})
        assert response2.status_code == 304

        # Verify security headers are present
        assert "strict-transport-security" in response2.headers
        assert response2.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
        assert response2.headers.get("x-content-type-options") == "nosniff"
        assert response2.headers.get("x-frame-options") == "DENY"


class TestETagIntegration:
    """Integration tests for ETag with real endpoints."""

    @pytest.mark.asyncio
    async def test__etag_integration__bookmark_crud_etag_changes(
        self, client: AsyncClient,
    ) -> None:
        """ETag should change when bookmark is updated."""
        # Create bookmark
        create_response = await client.post(
            "/bookmarks/",
            json={"url": "https://etag-test.com", "title": "Initial Title"},
        )
        assert create_response.status_code == 201
        bookmark_id = create_response.json()["id"]

        # GET bookmark, note ETag
        get_response1 = await client.get(f"/bookmarks/{bookmark_id}")
        assert get_response1.status_code == 200
        etag1 = get_response1.headers["etag"]

        # GET again with If-None-Match - should be 304
        get_response2 = await client.get(
            f"/bookmarks/{bookmark_id}",
            headers={"If-None-Match": etag1},
        )
        assert get_response2.status_code == 304

        # Update bookmark
        update_response = await client.patch(
            f"/bookmarks/{bookmark_id}",
            json={"title": "Updated Title"},
        )
        assert update_response.status_code == 200

        # GET with old ETag - should be 200 with new ETag
        get_response3 = await client.get(
            f"/bookmarks/{bookmark_id}",
            headers={"If-None-Match": etag1},
        )
        assert get_response3.status_code == 200
        etag2 = get_response3.headers["etag"]
        assert etag2 != etag1  # ETag changed

        # New ETag should work for 304
        get_response4 = await client.get(
            f"/bookmarks/{bookmark_id}",
            headers={"If-None-Match": etag2},
        )
        assert get_response4.status_code == 304

    @pytest.mark.asyncio
    async def test__etag_integration__list_endpoint(
        self, client: AsyncClient,
    ) -> None:
        """List endpoints should also receive ETags."""
        # Create some bookmarks
        await client.post("/bookmarks/", json={"url": "https://list1.com"})
        await client.post("/bookmarks/", json={"url": "https://list2.com"})

        # GET list
        response1 = await client.get("/bookmarks/")
        assert response1.status_code == 200
        assert "etag" in response1.headers
        etag = response1.headers["etag"]

        # GET list with If-None-Match - should be 304 (no changes)
        response2 = await client.get("/bookmarks/", headers={"If-None-Match": etag})
        assert response2.status_code == 304

    @pytest.mark.asyncio
    async def test__etag_integration__rate_limit_headers_preserved(
        self, client: AsyncClient,
    ) -> None:
        """Rate limit headers should be preserved alongside ETag headers."""
        # Use an authenticated endpoint that has rate limiting
        response = await client.get("/bookmarks/")
        assert response.status_code == 200

        # Both ETag and rate limit headers should be present
        assert "etag" in response.headers
        assert "x-ratelimit-limit" in response.headers
        assert "x-ratelimit-remaining" in response.headers
        assert "x-ratelimit-reset" in response.headers


class TestHttpDateFormatting:
    """Tests for HTTP date formatting and parsing."""

    def test__format_http_date__produces_valid_format(self) -> None:
        """format_http_date should produce RFC 7231 format."""
        dt = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)
        result = format_http_date(dt)
        # Should be in format: "Wed, 15 Jan 2026 10:30:00 GMT"
        assert "15 Jan 2026" in result
        assert "10:30:00" in result
        assert result.endswith("GMT")

    def test__parse_http_date__valid_date(self) -> None:
        """parse_http_date should parse valid HTTP date strings."""
        date_str = "Wed, 15 Jan 2026 10:30:00 GMT"
        result = parse_http_date(date_str)
        assert result is not None
        assert result.year == 2026
        assert result.month == 1
        assert result.day == 15
        assert result.hour == 10
        assert result.minute == 30

    def test__parse_http_date__invalid_date_returns_none(self) -> None:
        """parse_http_date should return None for invalid dates."""
        assert parse_http_date("not a date") is None
        assert parse_http_date("") is None

    def test__format_parse_roundtrip(self) -> None:
        """Formatting then parsing should return equivalent datetime."""
        original = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)
        formatted = format_http_date(original)
        parsed = parse_http_date(formatted)
        assert parsed is not None
        # Compare with second precision (HTTP dates don't have microseconds)
        assert parsed.replace(microsecond=0) == original.replace(microsecond=0)


class TestCheckNotModified:
    """Tests for check_not_modified helper function."""

    def test__check_not_modified__no_header_returns_none(self) -> None:
        """Returns None when If-Modified-Since header is absent."""
        request = MagicMock()
        request.headers = {}
        updated_at = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)

        result = check_not_modified(request, updated_at)
        assert result is None

    def test__check_not_modified__if_none_match_present_returns_none(self) -> None:
        """Returns None when If-None-Match is present (ETag takes precedence)."""
        request = MagicMock()
        request.headers = {
            "if-none-match": 'W/"abc123"',
            "if-modified-since": "Wed, 15 Jan 2026 10:30:00 GMT",
        }
        updated_at = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)

        result = check_not_modified(request, updated_at)
        assert result is None

    def test__check_not_modified__resource_not_modified_returns_304(self) -> None:
        """Returns 304 response when resource hasn't been modified."""
        request = MagicMock()
        request.headers = {"if-modified-since": "Wed, 15 Jan 2026 10:30:00 GMT"}
        # Same time as client's cached version
        updated_at = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)

        result = check_not_modified(request, updated_at)
        assert result is not None
        assert result.status_code == 304

    def test__check_not_modified__resource_modified_returns_none(self) -> None:
        """Returns None when resource has been modified since client's version."""
        request = MagicMock()
        request.headers = {"if-modified-since": "Wed, 15 Jan 2026 10:30:00 GMT"}
        # Resource updated after client's cached version
        updated_at = datetime(2026, 1, 15, 10, 31, 0, tzinfo=UTC)

        result = check_not_modified(request, updated_at)
        assert result is None

    def test__check_not_modified__304_includes_caching_headers(self) -> None:
        """304 response should include Cache-Control and Vary headers."""
        request = MagicMock()
        request.headers = {"if-modified-since": "Wed, 15 Jan 2026 10:30:00 GMT"}
        updated_at = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)

        result = check_not_modified(request, updated_at)
        assert result is not None
        assert result.headers.get("cache-control") == "private, must-revalidate"
        assert result.headers.get("vary") == "Authorization"
        assert "last-modified" in result.headers

    def test__check_not_modified__invalid_date_returns_none(self) -> None:
        """Returns None when If-Modified-Since header is malformed."""
        request = MagicMock()
        request.headers = {"if-modified-since": "not a valid date"}
        updated_at = datetime(2026, 1, 15, 10, 30, 0, tzinfo=UTC)

        result = check_not_modified(request, updated_at)
        assert result is None


class TestLastModifiedIntegration:
    """Integration tests for Last-Modified with real endpoints."""

    @pytest.mark.asyncio
    async def test__last_modified__bookmark_returns_header(
        self, client: AsyncClient,
    ) -> None:
        """GET /bookmarks/{id} should include Last-Modified header."""
        # Create bookmark
        create_response = await client.post(
            "/bookmarks/",
            json={"url": "https://lastmod-test.com", "title": "Test"},
        )
        assert create_response.status_code == 201
        bookmark_id = create_response.json()["id"]

        # GET bookmark should include Last-Modified
        response = await client.get(f"/bookmarks/{bookmark_id}")
        assert response.status_code == 200
        assert "last-modified" in response.headers

    @pytest.mark.asyncio
    async def test__last_modified__if_modified_since_returns_304(
        self, client: AsyncClient,
    ) -> None:
        """GET with If-Modified-Since should return 304 if unchanged."""
        # Create bookmark
        create_response = await client.post(
            "/bookmarks/",
            json={"url": "https://lastmod-304.com", "title": "Test"},
        )
        bookmark_id = create_response.json()["id"]

        # GET to get Last-Modified
        response1 = await client.get(f"/bookmarks/{bookmark_id}")
        last_modified = response1.headers["last-modified"]

        # GET with If-Modified-Since (and no If-None-Match) should return 304
        response2 = await client.get(
            f"/bookmarks/{bookmark_id}",
            headers={"If-Modified-Since": last_modified},
        )
        assert response2.status_code == 304

    @pytest.mark.asyncio
    async def test__last_modified__etag_takes_precedence(
        self, client: AsyncClient,
    ) -> None:
        """If-None-Match should take precedence over If-Modified-Since."""
        # Create bookmark
        create_response = await client.post(
            "/bookmarks/",
            json={"url": "https://precedence-test.com", "title": "Test"},
        )
        bookmark_id = create_response.json()["id"]

        # GET to get headers
        response1 = await client.get(f"/bookmarks/{bookmark_id}")
        etag = response1.headers["etag"]
        last_modified = response1.headers["last-modified"]

        # With both headers, ETag (If-None-Match) should be used
        response2 = await client.get(
            f"/bookmarks/{bookmark_id}",
            headers={
                "If-None-Match": etag,
                "If-Modified-Since": last_modified,
            },
        )
        # Should be 304 from ETag match (via middleware)
        assert response2.status_code == 304
        # Should have ETag in response (from middleware)
        assert "etag" in response2.headers

    @pytest.mark.asyncio
    async def test__last_modified__note_returns_header(
        self, client: AsyncClient,
    ) -> None:
        """GET /notes/{id} should include Last-Modified header."""
        # Create note
        create_response = await client.post(
            "/notes/",
            json={"title": "Test Note", "content": "Content"},
        )
        assert create_response.status_code == 201
        note_id = create_response.json()["id"]

        # GET note should include Last-Modified
        response = await client.get(f"/notes/{note_id}")
        assert response.status_code == 200
        assert "last-modified" in response.headers

    @pytest.mark.asyncio
    async def test__last_modified__prompt_by_id_returns_header(
        self, client: AsyncClient,
    ) -> None:
        """GET /prompts/{id} should include Last-Modified header."""
        # Create prompt
        create_response = await client.post(
            "/prompts/",
            json={
                "name": "test-prompt",
                "content": "Hello {{ name }}",
                "arguments": [{"name": "name", "required": True}],
            },
        )
        assert create_response.status_code == 201
        prompt_id = create_response.json()["id"]

        # GET prompt by ID should include Last-Modified
        response = await client.get(f"/prompts/{prompt_id}")
        assert response.status_code == 200
        assert "last-modified" in response.headers

    @pytest.mark.asyncio
    async def test__last_modified__prompt_by_name_returns_header(
        self, client: AsyncClient,
    ) -> None:
        """GET /prompts/name/{name} should include Last-Modified header."""
        # Create prompt
        await client.post(
            "/prompts/",
            json={
                "name": "named-prompt",
                "content": "Hello {{ name }}",
                "arguments": [{"name": "name", "required": True}],
            },
        )

        # GET prompt by name should include Last-Modified
        response = await client.get("/prompts/name/named-prompt")
        assert response.status_code == 200
        assert "last-modified" in response.headers

    @pytest.mark.asyncio
    async def test__last_modified__304_has_security_headers(
        self, client: AsyncClient,
    ) -> None:
        """304 from Last-Modified should include security headers."""
        # Create bookmark
        create_response = await client.post(
            "/bookmarks/",
            json={"url": "https://security-304.com", "title": "Test"},
        )
        bookmark_id = create_response.json()["id"]

        # GET to get Last-Modified
        response1 = await client.get(f"/bookmarks/{bookmark_id}")
        last_modified = response1.headers["last-modified"]

        # GET with If-Modified-Since
        response2 = await client.get(
            f"/bookmarks/{bookmark_id}",
            headers={"If-Modified-Since": last_modified},
        )
        assert response2.status_code == 304

        # Security headers should be present
        assert "strict-transport-security" in response2.headers
        assert response2.headers.get("x-content-type-options") == "nosniff"
        assert response2.headers.get("x-frame-options") == "DENY"

    @pytest.mark.asyncio
    async def test__last_modified__404_for_nonexistent(
        self, client: AsyncClient,
    ) -> None:
        """Non-existent resource should return 404, not 304."""
        response = await client.get(
            "/bookmarks/00000000-0000-0000-0000-000000000000",
            headers={"If-Modified-Since": "Wed, 15 Jan 2026 10:30:00 GMT"},
        )
        assert response.status_code == 404
