"""Service layer for user settings operations."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.user_settings import UserSettings


async def get_settings(db: AsyncSession, user_id: int) -> UserSettings | None:
    """Get user settings, returns None if not exists."""
    query = select(UserSettings).where(UserSettings.user_id == user_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_or_create_settings(db: AsyncSession, user_id: int) -> UserSettings:
    """Get user settings, creating default if not exists."""
    settings = await get_settings(db, user_id)
    if settings is None:
        settings = UserSettings(user_id=user_id)
        db.add(settings)
        await db.flush()
        await db.refresh(settings)
    return settings
