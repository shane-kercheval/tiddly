"""Async SQLAlchemy session factory."""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import get_settings


settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def get_session_factory() -> async_sessionmaker:
    """Return the session factory for services that need concurrent queries."""
    return async_session_factory


async def get_async_session() -> AsyncGenerator[AsyncSession]:
    """
    Yield an async database session.

    Uses unit-of-work pattern: services use flush() for refreshing objects,
    commit happens once here at request end. This ensures atomic transactions
    per request - if anything fails, all changes are rolled back.
    """
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
