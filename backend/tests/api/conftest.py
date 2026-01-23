"""Shared fixtures for API tests."""
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.policy_versions import PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION
from models.user import User
from models.user_consent import UserConsent


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


# Constant for non-existent entity ID
FAKE_UUID = "00000000-0000-0000-0000-000000000000"
