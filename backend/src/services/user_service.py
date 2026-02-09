"""Service layer for user creation."""
from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User
from services import content_filter_service


async def create_user_with_defaults(
    db: AsyncSession,
    auth0_id: str,
    email: str | None = None,
) -> User:
    """Create a user and default content filters."""
    user = User(auth0_id=auth0_id, email=email)
    db.add(user)
    await db.flush()
    # New user has no consent - set explicitly to avoid lazy load
    user.consent = None
    await content_filter_service.ensure_default_filters(db, user.id)
    return user
