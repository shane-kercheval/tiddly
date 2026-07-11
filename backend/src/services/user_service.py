"""Service layer for user creation."""
from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User
from services import content_filter_service


async def create_user_with_defaults(
    db: AsyncSession,
    *,
    auth0_id: str | None = None,
    external_auth_id: str | None = None,
    email: str | None = None,
    email_verified: bool | None = None,
) -> User:
    """
    Create a user and default content filters.

    Exactly one provider identifier is required — whichever the verified token
    supplied (Auth0 `sub` or Clerk `sub`). The users table CHECK constraint
    (`ck_user_has_identity`) backstops this at the database level.
    """
    if (auth0_id is None) == (external_auth_id is None):
        raise ValueError(
            "Exactly one of auth0_id or external_auth_id is required to create a user.",
        )
    user = User(
        auth0_id=auth0_id,
        external_auth_id=external_auth_id,
        email=email,
        email_verified=email_verified,
    )
    db.add(user)
    await db.flush()
    # New user has no consent - set explicitly to avoid lazy load
    user.consent = None
    await content_filter_service.ensure_default_filters(db, user.id)
    return user
