"""
Tests for `get_for_update(...)` and `get_by_name_for_update(...)`.

Two concerns are tested:

  1. Contract: filter semantics (missing entity, archived, soft-deleted) match
     the documented behavior of the read-path methods.

  2. Lock semantics: real Postgres `SELECT ... FOR UPDATE` behavior across
     independent transactions. We use the `concurrent_session_factory` fixture
     (see backend/tests/conftest.py) instead of the standard
     `db_session_factory`, because the standard factory binds every session to
     a single connection wrapped in one outer transaction — cross-session lock
     contention is impossible in that shape.

Blocking is proven by the strongest assertion available: spawn B as a task, A
modifies + commits a sentinel value, await B, assert B observes the sentinel.
That single chain proves (a) B was blocked while A held the lock (otherwise B
would have read the pre-A state), (b) the lock was released on A's commit,
and (c) B reads correct post-commit state. We deliberately avoid
`asyncio.wait_for(..., timeout=...)` + `TimeoutError` to assert blocking —
that pattern proves "the driver cancelled the query," not "the row was locked."

We do not re-test Postgres's responsibilities (deadlock detection, lock
fairness) — only the wrapper's contract.
"""
import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from models.bookmark import Bookmark
from models.prompt import Prompt
from models.user import User
from services.bookmark_service import BookmarkService
from services.prompt_service import PromptService


bookmark_service = BookmarkService()
prompt_service = PromptService()


# Yield to the scheduler long enough for the spawned task to start its query
# and reach the FOR UPDATE wait. We don't assert "still pending" off this
# sleep — that's timing-fragile and redundant given the post-state assertion.
TASK_START_DELAY = 0.1

# Generous ceiling for awaiting a task that should unblock once we release the
# lock. Postgres releases on commit/rollback; the task should resume within
# tens of milliseconds in practice.
UNBLOCK_TIMEOUT = 5.0

# Short timeout for "must return quickly" assertions (plain reads on a locked
# row). Just needs to comfortably exceed normal query latency.
QUICK_RETURN_TIMEOUT = 0.5


# ---------------------------------------------------------------------------
# Helpers / per-test seeding
# ---------------------------------------------------------------------------


@pytest.fixture
async def seeded_bookmark(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> Bookmark:
    """Insert one active bookmark under the per-test user."""
    async with concurrent_session_factory() as session:
        bookmark = Bookmark(
            user_id=concurrent_test_user.id,
            url=f"https://example.com/{uuid4().hex}",
            title="lock-test",
            description="seed",
            content="original",
        )
        session.add(bookmark)
        await session.commit()
        await session.refresh(bookmark)
        return bookmark


@pytest.fixture
async def seeded_prompt(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> Prompt:
    """Insert one active prompt under the per-test user."""
    async with concurrent_session_factory() as session:
        prompt = Prompt(
            user_id=concurrent_test_user.id,
            name=f"lock-test-{uuid4().hex[:8]}",
            title="Lock test",
            description="seed",
            content="original",
            arguments=[],
        )
        session.add(prompt)
        await session.commit()
        await session.refresh(prompt)
        return prompt


# ---------------------------------------------------------------------------
# `BaseEntityService.get_for_update(...)` — contract
# ---------------------------------------------------------------------------


async def test_get_for_update_returns_none_for_missing_entity(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """A nonexistent id returns None, not an error."""
    async with concurrent_session_factory() as session:
        result = await bookmark_service.get_for_update(
            session, concurrent_test_user.id, uuid4(),
        )
        assert result is None


async def test_get_for_update_excludes_archived_by_default(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """Archived entities are excluded when `include_archived=False` (the default)."""
    async with concurrent_session_factory() as session:
        bookmark = Bookmark(
            user_id=concurrent_test_user.id,
            url=f"https://example.com/{uuid4().hex}",
            title="archived",
            archived_at=datetime.now(UTC),
        )
        session.add(bookmark)
        await session.commit()
        await session.refresh(bookmark)

        result = await bookmark_service.get_for_update(
            session, concurrent_test_user.id, bookmark.id,
        )
        assert result is None


async def test_get_for_update_includes_archived_when_requested(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """`include_archived=True` returns archived entities."""
    async with concurrent_session_factory() as session:
        bookmark = Bookmark(
            user_id=concurrent_test_user.id,
            url=f"https://example.com/{uuid4().hex}",
            title="archived",
            archived_at=datetime.now(UTC),
        )
        session.add(bookmark)
        await session.commit()
        await session.refresh(bookmark)

        result = await bookmark_service.get_for_update(
            session, concurrent_test_user.id, bookmark.id, include_archived=True,
        )
        assert result is not None
        assert result.id == bookmark.id


async def test_get_for_update_always_excludes_soft_deleted(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """Soft-deleted entities are always excluded, even with `include_archived=True`."""
    async with concurrent_session_factory() as session:
        bookmark = Bookmark(
            user_id=concurrent_test_user.id,
            url=f"https://example.com/{uuid4().hex}",
            title="deleted",
            deleted_at=datetime.now(UTC),
        )
        session.add(bookmark)
        await session.commit()
        await session.refresh(bookmark)

        result = await bookmark_service.get_for_update(
            session, concurrent_test_user.id, bookmark.id, include_archived=True,
        )
        assert result is None


# ---------------------------------------------------------------------------
# `BaseEntityService.get_for_update(...)` — lock semantics
# ---------------------------------------------------------------------------


async def test_get_for_update_blocks_until_commit(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
    seeded_bookmark: Bookmark,
) -> None:
    """
    While A holds the row lock, B's FOR UPDATE blocks until A commits.

    The assertion `B saw "committed-by-a"` proves three things at once:
      (a) B was blocked while A held the lock — otherwise it would have read
          the pre-A value "original";
      (b) the lock was released on A's commit;
      (c) B read the correct post-commit state.
    """
    async def acquire_in_b() -> Bookmark | None:
        async with concurrent_session_factory() as session_b:
            return await bookmark_service.get_for_update(
                session_b, concurrent_test_user.id, seeded_bookmark.id,
            )

    async with concurrent_session_factory() as session_a:
        locked = await bookmark_service.get_for_update(
            session_a, concurrent_test_user.id, seeded_bookmark.id,
        )
        assert locked is not None
        locked.content = "committed-by-a"
        await session_a.flush()

        b_task = asyncio.create_task(acquire_in_b())
        await asyncio.sleep(TASK_START_DELAY)
        await session_a.commit()

    result = await asyncio.wait_for(b_task, timeout=UNBLOCK_TIMEOUT)
    assert result is not None
    assert result.content == "committed-by-a"


async def test_get_for_update_blocks_until_rollback(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
    seeded_bookmark: Bookmark,
) -> None:
    """
    While A holds the row lock, B's FOR UPDATE blocks until A rolls back.

    The assertion `B saw "original"` proves both that the lock was released
    on rollback AND that A's uncommitted change is invisible to B.
    """
    async def acquire_in_b() -> Bookmark | None:
        async with concurrent_session_factory() as session_b:
            return await bookmark_service.get_for_update(
                session_b, concurrent_test_user.id, seeded_bookmark.id,
            )

    async with concurrent_session_factory() as session_a:
        locked = await bookmark_service.get_for_update(
            session_a, concurrent_test_user.id, seeded_bookmark.id,
        )
        assert locked is not None
        locked.content = "uncommitted-change"
        await session_a.flush()

        b_task = asyncio.create_task(acquire_in_b())
        await asyncio.sleep(TASK_START_DELAY)
        await session_a.rollback()

    result = await asyncio.wait_for(b_task, timeout=UNBLOCK_TIMEOUT)
    assert result is not None
    assert result.content == "original"


async def test_plain_get_does_not_block_on_for_update_lock(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
    seeded_bookmark: Bookmark,
) -> None:
    """Plain `get(...)` (a non-locking SELECT) must not block on a FOR UPDATE lock."""
    async def plain_get_in_b() -> Bookmark | None:
        async with concurrent_session_factory() as session_b:
            return await bookmark_service.get(
                session_b, concurrent_test_user.id, seeded_bookmark.id,
            )

    async with concurrent_session_factory() as session_a:
        locked = await bookmark_service.get_for_update(
            session_a, concurrent_test_user.id, seeded_bookmark.id,
        )
        assert locked is not None

        # B must return well before QUICK_RETURN_TIMEOUT. wait_for is the
        # right primitive here: the assertion *is* "returns quickly."
        result = await asyncio.wait_for(plain_get_in_b(), timeout=QUICK_RETURN_TIMEOUT)
        assert result is not None
        assert result.id == seeded_bookmark.id


# ---------------------------------------------------------------------------
# `PromptService.get_by_name_for_update(...)` — contract + lock semantics
# ---------------------------------------------------------------------------


async def test_get_by_name_for_update_excludes_inactive(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """By-name variant returns active prompts only (archived and soft-deleted excluded)."""
    async with concurrent_session_factory() as session:
        archived = Prompt(
            user_id=concurrent_test_user.id,
            name=f"archived-{uuid4().hex[:8]}",
            title="archived",
            content="x",
            arguments=[],
            archived_at=datetime.now(UTC),
        )
        deleted = Prompt(
            user_id=concurrent_test_user.id,
            name=f"deleted-{uuid4().hex[:8]}",
            title="deleted",
            content="x",
            arguments=[],
            deleted_at=datetime.now(UTC),
        )
        session.add_all([archived, deleted])
        await session.commit()
        await session.refresh(archived)
        await session.refresh(deleted)

        assert await prompt_service.get_by_name_for_update(
            session, concurrent_test_user.id, archived.name,
        ) is None
        assert await prompt_service.get_by_name_for_update(
            session, concurrent_test_user.id, deleted.name,
        ) is None


async def test_get_by_name_for_update_blocks_until_commit(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
    seeded_prompt: Prompt,
) -> None:
    """By-name lock variant blocks a concurrent by-name FOR UPDATE and releases on commit."""
    async def acquire_in_b() -> Prompt | None:
        async with concurrent_session_factory() as session_b:
            return await prompt_service.get_by_name_for_update(
                session_b, concurrent_test_user.id, seeded_prompt.name,
            )

    async with concurrent_session_factory() as session_a:
        locked = await prompt_service.get_by_name_for_update(
            session_a, concurrent_test_user.id, seeded_prompt.name,
        )
        assert locked is not None
        assert locked.id == seeded_prompt.id
        locked.content = "committed-by-a"
        await session_a.flush()

        b_task = asyncio.create_task(acquire_in_b())
        await asyncio.sleep(TASK_START_DELAY)
        await session_a.commit()

    result = await asyncio.wait_for(b_task, timeout=UNBLOCK_TIMEOUT)
    assert result is not None
    assert result.content == "committed-by-a"
