"""Tests for user authentication endpoints."""
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_limits
from core.tier_limits import TIER_LIMITS, Tier, get_tier_limits
from models.user import User
from schemas.cached_user import CachedUser


async def test_get_me_in_dev_mode_returns_dev_user(client: AsyncClient) -> None:
    """Test that /users/me returns dev user when DEV_MODE=true."""
    response = await client.get("/users/me")
    assert response.status_code == 200

    data = response.json()
    assert data["auth0_id"] == "dev|local-development-user"
    assert data["email"] == "dev@localhost"


async def test_get_me_creates_user_on_first_request(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that user is created in database on first authenticated request."""
    # Make request
    response = await client.get("/users/me")
    assert response.status_code == 200

    # Verify user was created in database
    result = await db_session.execute(
        select(User).where(User.auth0_id == "dev|local-development-user"),
    )
    user = result.scalar_one_or_none()
    assert user is not None
    assert user.email == "dev@localhost"


async def test_get_me_returns_same_user_on_subsequent_requests(
    client: AsyncClient,
) -> None:
    """Test that the same user is returned on multiple requests."""
    response1 = await client.get("/users/me")
    response2 = await client.get("/users/me")

    assert response1.status_code == 200
    assert response2.status_code == 200

    data1 = response1.json()
    data2 = response2.json()

    # Same user ID should be returned
    assert data1["id"] == data2["id"]


async def test_get_me_response_structure(client: AsyncClient) -> None:
    """Test that /users/me returns expected response structure."""
    response = await client.get("/users/me")
    assert response.status_code == 200

    data = response.json()
    assert "id" in data
    assert "auth0_id" in data
    assert "email" in data
    assert isinstance(data["id"], str)
    assert isinstance(data["auth0_id"], str)


class TestGetMyLimits:
    """Tests for GET /users/me/limits endpoint."""

    async def test__get_my_limits__returns_dev_tier_limits_in_dev_mode(
        self,
        client: AsyncClient,
    ) -> None:
        """Test that /users/me/limits returns DEV tier limits in dev mode."""
        response = await client.get("/users/me/limits")
        assert response.status_code == 200

        data = response.json()
        dev_limits = TIER_LIMITS[Tier.DEV]
        assert data["tier"] == "dev"
        assert data["max_bookmarks"] == dev_limits.max_bookmarks
        assert data["max_notes"] == dev_limits.max_notes
        assert data["max_prompts"] == dev_limits.max_prompts
        assert data["rate_read_per_minute"] == dev_limits.rate_read_per_minute
        assert data["rate_read_per_day"] == dev_limits.rate_read_per_day
        assert data["rate_write_per_minute"] == dev_limits.rate_write_per_minute
        assert data["rate_write_per_day"] == dev_limits.rate_write_per_day
        assert data["rate_sensitive_per_minute"] == dev_limits.rate_sensitive_per_minute
        assert data["rate_sensitive_per_day"] == dev_limits.rate_sensitive_per_day

    async def test__get_my_limits__returns_all_limit_fields(
        self,
        client: AsyncClient,
    ) -> None:
        """Test that response includes all expected limit fields."""
        response = await client.get("/users/me/limits")
        assert response.status_code == 200

        data = response.json()

        # Tier
        assert "tier" in data

        # Item counts
        assert "max_bookmarks" in data
        assert "max_notes" in data
        assert "max_prompts" in data

        # Field lengths (common)
        assert "max_title_length" in data
        assert "max_description_length" in data
        assert "max_tag_name_length" in data

        # Field lengths (content)
        assert "max_bookmark_content_length" in data
        assert "max_note_content_length" in data
        assert "max_prompt_content_length" in data

        # Field lengths (entity-specific)
        assert "max_url_length" in data
        assert "max_prompt_name_length" in data
        assert "max_argument_name_length" in data
        assert "max_argument_description_length" in data

        # Rate limits
        assert "rate_read_per_minute" in data
        assert "rate_read_per_day" in data
        assert "rate_write_per_minute" in data
        assert "rate_write_per_day" in data
        assert "rate_sensitive_per_minute" in data
        assert "rate_sensitive_per_day" in data

    @pytest.mark.usefixtures("low_limits")
    async def test__get_my_limits__uses_low_limits_fixture(
        self,
        client: AsyncClient,
    ) -> None:
        """Test that low_limits fixture overrides default limits."""
        response = await client.get("/users/me/limits")
        assert response.status_code == 200

        data = response.json()
        # With low_limits fixture, max_bookmarks should be 2
        assert data["max_bookmarks"] == 2
        assert data["max_notes"] == 2
        assert data["max_prompts"] == 2
        assert data["max_title_length"] == 10

    async def test__get_my_limits__returns_free_tier_when_not_dev_mode(
        self,
        client: AsyncClient,
    ) -> None:
        """Test that /users/me/limits returns FREE tier when dev mode is off."""
        from api.main import app  # noqa: PLC0415
        from core.auth import get_current_user as _get_current_user  # noqa: PLC0415
        from core.config import get_settings as _get_settings  # noqa: PLC0415

        mock_user = MagicMock()
        mock_user.tier = "free"
        mock_settings = MagicMock()
        mock_settings.dev_mode = False

        app.dependency_overrides[_get_current_user] = lambda: mock_user
        app.dependency_overrides[_get_settings] = lambda: mock_settings
        try:
            response = await client.get("/users/me/limits")
        finally:
            app.dependency_overrides.pop(_get_current_user, None)
            app.dependency_overrides.pop(_get_settings, None)

        assert response.status_code == 200
        data = response.json()
        free_limits = TIER_LIMITS[Tier.FREE]
        assert data["tier"] == "free"
        assert data["max_bookmarks"] == free_limits.max_bookmarks
        assert data["max_notes"] == free_limits.max_notes
        assert data["max_prompts"] == free_limits.max_prompts


class TestGetCurrentLimits:
    """Tests for get_current_limits dependency."""

    def test__get_current_limits__returns_dev_limits_in_dev_mode(self) -> None:
        """In dev mode, returns DEV tier limits regardless of user's stored tier."""
        user = MagicMock(spec=CachedUser)
        user.tier = "free"
        settings = MagicMock()
        settings.dev_mode = True

        result = get_current_limits(current_user=user, settings=settings)
        assert result is get_tier_limits(Tier.DEV)

    def test__get_current_limits__returns_user_tier_limits_when_not_dev_mode(self) -> None:
        """When not in dev mode, resolves limits from user's stored tier."""
        user = MagicMock(spec=CachedUser)
        user.tier = "free"
        settings = MagicMock()
        settings.dev_mode = False

        result = get_current_limits(current_user=user, settings=settings)
        assert result is get_tier_limits(Tier.FREE)
