"""
Tests for RequestContext functionality in the auth module.

Imports from core.auth are deferred to inside test functions because
core.auth -> db.session -> get_settings() at module level, which requires
DATABASE_URL. Deferring avoids collection failures in CI where the env var
isn't set until the test session fixtures run.
"""
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User

if TYPE_CHECKING:
    from core.config import Settings


@pytest.fixture
def mock_request() -> Request:
    """Create a mock request for auth tests."""
    request = MagicMock(spec=Request)
    request.headers = {}
    request.state = MagicMock()
    return request


@pytest.fixture
def mock_request_with_source() -> callable:
    """Factory fixture to create mock request with specific X-Request-Source header."""
    def _create(source_value: str) -> Request:
        request = MagicMock(spec=Request)
        request.headers = {"x-request-source": source_value}
        request.state = MagicMock()
        return request
    return _create


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user for auth tests."""
    user = User(
        auth0_id="test-auth0-id-context",
        email="context@test.com",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def mock_settings_no_dev_mode() -> "Settings":
    """Create mock settings with dev_mode=False."""
    settings = MagicMock()
    settings.dev_mode = False
    settings.frontend_url = "http://localhost:5173"
    settings.api_url = "http://localhost:8000"
    return settings


@pytest.fixture
def mock_settings_dev_mode() -> "Settings":
    """Create mock settings with dev_mode=True."""
    settings = MagicMock()
    settings.dev_mode = True
    return settings


class TestGetRequestSource:
    """Tests for _get_request_source function."""

    def test__get_request_source__web_header(
        self,
        mock_request_with_source: callable,
    ) -> None:
        """X-Request-Source: web sets source to WEB."""
        request = mock_request_with_source("web")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "web"

    def test__get_request_source__api_header(
        self,
        mock_request_with_source: callable,
    ) -> None:
        """X-Request-Source: api sets source to API."""
        request = mock_request_with_source("api")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "api"

    def test__get_request_source__mcp_content_header(
        self,
        mock_request_with_source: callable,
    ) -> None:
        """X-Request-Source: mcp-content sets source to MCP_CONTENT."""
        request = mock_request_with_source("mcp-content")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "mcp-content"

    def test__get_request_source__mcp_prompt_header(
        self,
        mock_request_with_source: callable,
    ) -> None:
        """X-Request-Source: mcp-prompt sets source to MCP_PROMPT."""
        request = mock_request_with_source("mcp-prompt")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "mcp-prompt"

    def test__get_request_source__missing_header_defaults_to_unknown(
        self,
        mock_request: Request,
    ) -> None:
        """Missing X-Request-Source header defaults to UNKNOWN."""
        from core.auth import _get_request_source
        source = _get_request_source(mock_request)
        assert source == "unknown"

    def test__get_request_source__unrecognized_header_passes_through(
        self,
        mock_request_with_source: callable,
    ) -> None:
        """Unrecognized X-Request-Source header is passed through as-is."""
        request = mock_request_with_source("iphone")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "iphone"

    def test__get_request_source__case_insensitive(
        self,
        mock_request_with_source: callable,
    ) -> None:
        """X-Request-Source header is case-insensitive."""
        request = mock_request_with_source("WEB")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "web"

        request = mock_request_with_source("MCP-Content")
        from core.auth import _get_request_source
        source = _get_request_source(request)
        assert source == "mcp-content"


class TestRequestContextWithAuth0:
    """Tests for RequestContext being set correctly with Auth0 JWT."""

    @pytest.mark.asyncio
    async def test__auth0_jwt__sets_auth_type_auth0(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_settings_no_dev_mode: "Settings",
        mock_request: Request,
    ) -> None:
        """Auth0 JWT sets auth_type to AUTH0."""
        from core.auth import AuthType, _authenticate_user

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.valid",
        )

        mock_payload = {"sub": test_user.auth0_id, "email": test_user.email}
        with patch("core.auth.decode_jwt", return_value=mock_payload):
            await _authenticate_user(
                mock_request, credentials, db_session, mock_settings_no_dev_mode,
            )

        # Check that request_context was set
        context = mock_request.state.request_context
        assert context.auth_type == AuthType.AUTH0
        assert context.token_prefix is None

    @pytest.mark.asyncio
    async def test__auth0_jwt__sets_source_from_header(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_settings_no_dev_mode: "Settings",
        mock_request_with_source: callable,
    ) -> None:
        """Auth0 JWT uses X-Request-Source header for source."""
        from core.auth import AuthType, _authenticate_user

        request = mock_request_with_source("web")
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.valid",
        )

        mock_payload = {"sub": test_user.auth0_id, "email": test_user.email}
        with patch("core.auth.decode_jwt", return_value=mock_payload):
            await _authenticate_user(
                request, credentials, db_session, mock_settings_no_dev_mode,
            )

        context = request.state.request_context
        assert context.source == "web"
        assert context.auth_type == AuthType.AUTH0


class TestRequestContextWithPAT:
    """Tests for RequestContext being set correctly with PAT."""

    @pytest.mark.asyncio
    async def test__pat__sets_auth_type_pat(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_settings_no_dev_mode: "Settings",
        mock_request: Request,
    ) -> None:
        """PAT sets auth_type to PAT."""
        from core.auth import AuthType, _authenticate_user

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="bm_valid_token_12345",
        )

        with patch(
            "core.auth.validate_pat",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, mock_settings_no_dev_mode,
            )

        context = mock_request.state.request_context
        assert context.auth_type == AuthType.PAT

    @pytest.mark.asyncio
    async def test__pat__sets_token_prefix(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_settings_no_dev_mode: "Settings",
        mock_request: Request,
    ) -> None:
        """PAT sets token_prefix to first 15 chars of token."""
        from core.auth import _authenticate_user

        token = "bm_a3f8xyz123456789abcdef"
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=token,
        )

        with patch(
            "core.auth.validate_pat",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, mock_settings_no_dev_mode,
            )

        context = mock_request.state.request_context
        # First 15 chars: "bm_a3f8xyz12345"
        assert context.token_prefix == "bm_a3f8xyz12345"
        assert len(context.token_prefix) == 15

    @pytest.mark.asyncio
    async def test__pat__short_token_uses_full_token_as_prefix(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_settings_no_dev_mode: "Settings",
        mock_request: Request,
    ) -> None:
        """PAT shorter than 15 chars uses full token as prefix."""
        from core.auth import _authenticate_user

        token = "bm_short"  # 8 chars
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials=token,
        )

        with patch(
            "core.auth.validate_pat",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            await _authenticate_user(
                mock_request, credentials, db_session, mock_settings_no_dev_mode,
            )

        context = mock_request.state.request_context
        assert context.token_prefix == "bm_short"

    @pytest.mark.asyncio
    async def test__pat__sets_source_from_header(
        self,
        db_session: AsyncSession,
        test_user: User,
        mock_settings_no_dev_mode: "Settings",
        mock_request_with_source: callable,
    ) -> None:
        """PAT uses X-Request-Source header for source."""
        from core.auth import AuthType, _authenticate_user

        request = mock_request_with_source("mcp-content")
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="bm_valid_token",
        )

        with patch(
            "core.auth.validate_pat",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            await _authenticate_user(
                request, credentials, db_session, mock_settings_no_dev_mode,
            )

        context = request.state.request_context
        assert context.source == "mcp-content"
        assert context.auth_type == AuthType.PAT


class TestRequestContextWithDevMode:
    """Tests for RequestContext in DEV_MODE."""

    @pytest.mark.asyncio
    async def test__dev_mode__sets_auth_type_dev(
        self,
        db_session: AsyncSession,
        mock_settings_dev_mode: "Settings",
        mock_request: Request,
    ) -> None:
        """DEV_MODE sets auth_type to DEV."""
        from core.auth import AuthType, _authenticate_user

        # Credentials don't matter in dev mode
        await _authenticate_user(
            mock_request, None, db_session, mock_settings_dev_mode,
        )

        context = mock_request.state.request_context
        assert context.auth_type == AuthType.DEV
        assert context.token_prefix is None

    @pytest.mark.asyncio
    async def test__dev_mode__sets_source_from_header(
        self,
        db_session: AsyncSession,
        mock_settings_dev_mode: "Settings",
        mock_request_with_source: callable,
    ) -> None:
        """DEV_MODE uses X-Request-Source header for source."""
        from core.auth import AuthType, _authenticate_user

        request = mock_request_with_source("web")
        await _authenticate_user(
            request, None, db_session, mock_settings_dev_mode,
        )

        context = request.state.request_context
        assert context.source == "web"
        assert context.auth_type == AuthType.DEV


class TestGetRequestContext:
    """Tests for get_request_context helper function."""

    def test__get_request_context__returns_context_when_set(
        self,
        mock_request: Request,
    ) -> None:
        """get_request_context returns the context when set."""
        from core.auth import AuthType, RequestContext, get_request_context

        expected_context = RequestContext(
            source="web",
            auth_type=AuthType.AUTH0,
            token_prefix=None,
        )
        mock_request.state.request_context = expected_context

        context = get_request_context(mock_request)
        assert context == expected_context

    def test__get_request_context__returns_none_when_not_set(self) -> None:
        """get_request_context returns None when context not set."""
        from core.auth import get_request_context

        request = MagicMock(spec=Request)
        request.state = MagicMock(spec=[])  # Empty spec means no attributes

        context = get_request_context(request)
        assert context is None
