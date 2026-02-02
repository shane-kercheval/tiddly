"""Tests for user authentication endpoints."""
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User


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

    async def test__get_my_limits__returns_free_tier_limits(
        self,
        client: AsyncClient,
    ) -> None:
        """Test that /users/me/limits returns limits for user's tier."""
        response = await client.get("/users/me/limits")
        assert response.status_code == 200

        data = response.json()
        assert data["tier"] == "free"
        assert data["max_bookmarks"] == 100
        assert data["max_notes"] == 100
        assert data["max_prompts"] == 100

        # Rate limits should match free tier
        assert data["rate_read_per_minute"] == 180
        assert data["rate_read_per_day"] == 4000
        assert data["rate_write_per_minute"] == 120
        assert data["rate_write_per_day"] == 4000
        assert data["rate_sensitive_per_minute"] == 30
        assert data["rate_sensitive_per_day"] == 250

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
