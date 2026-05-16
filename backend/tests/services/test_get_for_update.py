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

Two complementary techniques carry the lock proofs:

  - `_assert_row_is_locked` issues a `SELECT ... FOR UPDATE NOWAIT` from a
    third session. NOWAIT raises immediately if the row is locked, which
    deterministically confirms that lock state at the probe point — no
    timing dependence.
  - After releasing A's lock, await B's task and assert the post-state it
    observes (A's committed sentinel, or the pre-A "original" after rollback).
    This rules out scheduler races where B might have read pre-A state.

We deliberately avoid `asyncio.wait_for(..., timeout=...)` + `TimeoutError`
as a blocking proof — that pattern only shows "the driver cancelled the
query," not "the row was locked."

We do not re-test Postgres's responsibilities (deadlock detection, lock
fairness) — only the wrapper's contract.
"""
import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
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


async def _assert_row_is_locked(
    factory: async_sessionmaker,
    model: type,
    entity_id: UUID,
) -> None:
    """
    Deterministic probe: assert the given row is currently locked.

    `SELECT ... FOR UPDATE NOWAIT` raises `LockNotAvailableError` immediately
    if any other transaction holds the lock. Combined with a post-state
    assertion in the calling test, this turns timing-dependent "blocking"
    proofs into a deterministic lock-state check.
    """
    async with factory() as probe_session:
        with pytest.raises(DBAPIError, match="could not obtain lock"):
            await probe_session.execute(
                select(model)
                .where(model.id == entity_id)
                .with_for_update(nowait=True),
            )


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

    Two assertions carry the proof:
      1. Before spawning B, a `FOR UPDATE NOWAIT` probe from a third session
         deterministically confirms A holds the lock right now.
      2. After A commits, B unblocks and reads "committed-by-a" — proving B
         did not race ahead of A (which would have read "original" under
         READ COMMITTED) and that B reads the correct post-commit state.

    The `await asyncio.sleep(TASK_START_DELAY)` is a heuristic giving B time
    to start its query before A commits. The NOWAIT probe above is what makes
    this deterministic; the sleep is belt-and-suspenders for the post-state
    check.
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

        await _assert_row_is_locked(concurrent_session_factory, Bookmark, seeded_bookmark.id)

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

    Under READ COMMITTED, an uncommitted UPDATE in A is invisible to other
    sessions regardless of the FOR UPDATE lock — so the post-state assertion
    `B saw "original"` alone does not distinguish locked from unlocked
    behavior. The NOWAIT probe is what makes this test a real proof: it
    deterministically confirms A holds the lock before B is spawned. After
    A rolls back, B unblocks and reads "original", confirming both that the
    lock was released on rollback and that A's uncommitted change is gone.
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

        await _assert_row_is_locked(concurrent_session_factory, Bookmark, seeded_bookmark.id)

        b_task = asyncio.create_task(acquire_in_b())
        await asyncio.sleep(TASK_START_DELAY)
        await session_a.rollback()

    result = await asyncio.wait_for(b_task, timeout=UNBLOCK_TIMEOUT)
    assert result is not None
    assert result.content == "original"


async def test_row_lock_survives_savepoint_rollback(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
    seeded_bookmark: Bookmark,
) -> None:
    """
    A row lock held by the outer transaction is NOT released when a nested
    savepoint inside that transaction rolls back.

    `history_service.record_action` opens `db.begin_nested()` (a savepoint)
    for unique-constraint retries on the history version. If a savepoint
    rollback released the FOR UPDATE lock acquired earlier in the request
    transaction, concurrent str-replace calls could overlap. Postgres docs
    say row locks survive savepoint rollback; this test proves the property
    holds in our codebase against our SQLAlchemy version.

    Proven by direct lock-state probe using `SELECT ... FOR UPDATE NOWAIT`:
    if A still holds the lock, B's NOWAIT raises immediately (asyncpg's
    `LockNotAvailableError`, wrapped by SQLAlchemy as `DBAPIError`). An
    "A mutates + B reads sentinel" pattern would not work here — A's UPDATE
    would acquire its own implicit write lock, blocking B regardless of
    whether the FOR UPDATE survived. NOWAIT is unambiguous: it answers
    exactly "is the row locked right now?"
    """
    async with concurrent_session_factory() as session_a:
        locked = await bookmark_service.get_for_update(
            session_a, concurrent_test_user.id, seeded_bookmark.id,
        )
        assert locked is not None

        # Savepoint roundtrip with no work inside: begin_nested issues
        # SAVEPOINT; raising forces ROLLBACK TO SAVEPOINT on context exit.
        with pytest.raises(RuntimeError, match="savepoint-abort"):
            async with session_a.begin_nested():
                raise RuntimeError("savepoint-abort")

        # Probe from a separate session: if A still holds the lock,
        # NOWAIT raises immediately. This is the load-bearing assertion of
        # this test — it answers "is the FOR UPDATE lock still held after
        # the savepoint rollback?" deterministically.
        await _assert_row_is_locked(concurrent_session_factory, Bookmark, seeded_bookmark.id)

        await session_a.rollback()


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

        await _assert_row_is_locked(concurrent_session_factory, Prompt, seeded_prompt.id)

        b_task = asyncio.create_task(acquire_in_b())
        await asyncio.sleep(TASK_START_DELAY)
        await session_a.commit()

    result = await asyncio.wait_for(b_task, timeout=UNBLOCK_TIMEOUT)
    assert result is not None
    assert result.content == "committed-by-a"
