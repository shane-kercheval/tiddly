"""Shared fixtures for API tests."""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.main import app
from core.config import Settings, get_settings
from core.policy_versions import PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION
from db.session import get_async_session
from models.user import User
from models.user_consent import UserConsent
from schemas.token import TokenCreate
from services.token_service import create_token


async def add_consent_for_user(db_session: AsyncSession, user: User) -> None:
    """Add valid consent record for a user (required for non-dev mode tests)."""
    consent = UserConsent(
        user_id=user.id,
        consented_at=datetime.now(UTC),
        privacy_policy_version=PRIVACY_POLICY_VERSION,
        terms_of_service_version=TERMS_OF_SERVICE_VERSION,
    )
    db_session.add(consent)
    await db_session.flush()


@asynccontextmanager
async def create_user2_client(
    db_session: AsyncSession,
    auth0_id: str,
    email: str,
) -> AsyncGenerator[AsyncClient]:
    """
    Create an authenticated AsyncClient for a second user via PAT.

    Sets up a new user with consent and PAT, overrides FastAPI dependencies
    to disable dev_mode, and yields an AsyncClient authenticated as that user.
    Cleans up dependency overrides on exit.
    """
    user2 = User(auth0_id=auth0_id, email=email)
    db_session.add(user2)
    await db_session.flush()

    await add_consent_for_user(db_session, user2)

    _, user2_token = await create_token(
        db_session, user2.id, TokenCreate(name='Test Token'),
    )
    await db_session.flush()

    get_settings.cache_clear()

    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    def override_get_settings() -> Settings:
        return Settings(database_url='postgresql://test', dev_mode=False)

    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_settings] = override_get_settings

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url='http://test',
            headers={'Authorization': f'Bearer {user2_token}'},
        ) as user2_client:
            yield user2_client
    finally:
        app.dependency_overrides.clear()


# Constant for non-existent entity ID
FAKE_UUID = "00000000-0000-0000-0000-000000000000"
