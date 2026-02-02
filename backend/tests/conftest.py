"""Pytest fixtures for testing."""
import os
from collections.abc import AsyncGenerator, Generator
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from core.auth_cache import AuthCache, set_auth_cache
from core.config import Settings
from core.redis import RedisClient, set_redis_client
from core.tier_limits import Tier, TierLimits, get_tier_limits
from models.base import Base


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer]:
    """Start a PostgreSQL container for the test session."""
    with PostgresContainer("postgres:16", driver="asyncpg") as postgres:
        yield postgres


@pytest.fixture(scope="session")
def redis_container() -> Generator[RedisContainer]:
    """Start a Redis container for the test session."""
    with RedisContainer("redis:7-alpine") as redis:
        yield redis


def get_redis_url(container: RedisContainer) -> str:
    """Get Redis connection URL from container."""
    host = container.get_container_host_ip()
    port = container.get_exposed_port(6379)
    return f"redis://{host}:{port}"


@pytest.fixture(scope="session")
def database_url(postgres_container: PostgresContainer, redis_container: RedisContainer) -> str:
    """
    Get the database URL from the container and set it in environment.

    This must be set before any app imports that trigger Settings validation.
    """
    url = postgres_container.get_connection_url()
    os.environ["DATABASE_URL"] = url
    # Set Redis URL from container
    os.environ["REDIS_URL"] = get_redis_url(redis_container)
    # Ensure tests run in dev mode (bypasses auth) regardless of local .env
    os.environ["VITE_DEV_MODE"] = "true"
    return url


@pytest.fixture
async def async_engine(database_url: str) -> AsyncGenerator[AsyncEngine]:
    """Create an async engine for testing."""
    engine = create_async_engine(database_url, echo=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    await engine.dispose()


@pytest.fixture
async def db_connection(async_engine: AsyncEngine) -> AsyncGenerator[AsyncConnection]:
    """
    Create a connection with a transaction that will be rolled back after the test.

    This provides test isolation - each test runs in its own transaction
    that is rolled back, so tests don't affect each other.
    """
    async with async_engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()


@pytest.fixture
async def db_session(db_connection: AsyncConnection) -> AsyncGenerator[AsyncSession]:
    """
    Create an async session bound to the test transaction.

    Uses begin_nested() for savepoints, allowing the session's flush/commit
    to work within our outer test transaction.
    """
    session_factory = async_sessionmaker(
        bind=db_connection,
        class_=AsyncSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    async with session_factory() as session:
        yield session


@pytest.fixture
def db_session_factory(db_connection: AsyncConnection) -> async_sessionmaker:
    """Session factory bound to the test transaction for concurrent query tests."""
    return async_sessionmaker(
        bind=db_connection,
        class_=AsyncSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )


@pytest.fixture
async def redis_client(redis_container: RedisContainer) -> AsyncGenerator[RedisClient]:
    """Create a Redis client connected to the test container and set as global."""
    client = RedisClient(get_redis_url(redis_container))
    await client.connect()
    set_redis_client(client)  # Set as global for rate limiter

    # Set up auth cache
    auth_cache = AuthCache(client)
    set_auth_cache(auth_cache)

    yield client

    await client.flushdb()  # Clean up after each test
    await client.close()
    set_auth_cache(None)
    set_redis_client(None)


@pytest.fixture
async def client(
    db_session: AsyncSession,
    db_session_factory: async_sessionmaker,
    redis_client: RedisClient,
) -> AsyncGenerator[AsyncClient]:
    """Create a test client with database session and Redis overrides."""
    # Clear the settings cache so it picks up DATABASE_URL from environment
    from core.config import get_settings

    get_settings.cache_clear()

    from api.main import app
    from api.routers.mcp import get_concurrent_queries
    from db.session import get_async_session, get_session_factory

    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_session_factory] = lambda: db_session_factory
    app.dependency_overrides[get_concurrent_queries] = lambda: False

    # Set the global Redis client and auth cache for the test
    # (redis_client fixture already sets these, but we ensure they're set here too)
    set_redis_client(redis_client)
    auth_cache = AuthCache(redis_client)
    set_auth_cache(auth_cache)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    set_auth_cache(None)
    set_redis_client(None)


@pytest.fixture
async def rate_limit_client(
    client: AsyncClient,
) -> AsyncGenerator[AsyncClient]:
    """
    Wrap the standard test client to enable rate limiting.

    The standard client uses dev_mode=True which bypasses rate limiting.
    This fixture patches _apply_rate_limit to NOT skip rate limiting,
    while keeping auth in dev mode (so dev user still works).
    """
    from core import auth

    # Store the original function
    original_apply_rate_limit = auth._apply_rate_limit

    async def patched_apply_rate_limit(
        user: object,
        request: object,
        settings: Settings,
    ) -> None:
        """Apply rate limiting even in dev mode."""
        # Temporarily pretend we're not in dev mode for rate limiting
        original_dev_mode = settings.dev_mode
        try:
            # Use object.__setattr__ to bypass frozen settings if needed
            object.__setattr__(settings, "dev_mode", False)
            await original_apply_rate_limit(user, request, settings)
        finally:
            object.__setattr__(settings, "dev_mode", original_dev_mode)

    # Patch the function
    auth._apply_rate_limit = patched_apply_rate_limit
    try:
        yield client
    finally:
        # Restore original
        auth._apply_rate_limit = original_apply_rate_limit


# Low limits for testing tier-based limits with small values
LOW_TIER_LIMITS = TierLimits(
    max_bookmarks=2,
    max_notes=2,
    max_prompts=2,
    max_title_length=10,
    max_description_length=50,
    max_tag_name_length=10,
    max_bookmark_content_length=100,
    max_note_content_length=100,
    max_prompt_content_length=100,
    max_url_length=100,
    max_prompt_name_length=10,
    max_argument_name_length=10,
    max_argument_description_length=20,
    # Rate limits - low values for testing
    rate_read_per_minute=5,
    rate_read_per_day=20,
    rate_write_per_minute=3,
    rate_write_per_day=10,
    rate_sensitive_per_minute=2,
    rate_sensitive_per_day=5,
)


@pytest.fixture
def default_limits() -> TierLimits:
    """
    Get the default tier limits for testing.

    Use this fixture when calling service methods that require a limits parameter
    but you don't need to test limit enforcement.
    """
    return get_tier_limits(Tier.FREE)


@pytest.fixture
def low_limits() -> Generator[TierLimits]:
    """
    Override TIER_LIMITS with restrictive limits for testing.

    Use this fixture to test quota and field limit enforcement without
    depending on actual production limit values.
    """
    with patch.dict(
        "core.tier_limits.TIER_LIMITS",
        {Tier.FREE: LOW_TIER_LIMITS},
    ):
        yield LOW_TIER_LIMITS
