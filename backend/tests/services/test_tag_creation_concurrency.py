"""
Concurrency tests for `get_or_create_tags`: requests of one user creating new tags at once.

Each request's work commits only when the request ends, so a tag one request
creates stays invisible to every other request until then. Two requests that
added the same new tag both missed it in their lookup, and the second insert
hit the `uq_tags_user_id_name` unique constraint once the first committed:
the request failed with a 500. The helper now inserts with ON CONFLICT DO
NOTHING and looks the tags up again.

There is no lock, so two requests that each create two or more of the same
new tags in opposite orders can still deadlock (Postgres cancels one after
about a second). That case predates the fix and isn't tested here.

These use `concurrent_session_factory` (see backend/tests/conftest.py):
independent connections with real commits, because the races are
cross-transaction by nature and the shared-savepoint `db_session` fixture
cannot express them. Committed rows are removed by the cascade when
`concurrent_test_user` is deleted.

Each test forces one interleaving: A starts and holds its transaction open,
B's work starts as a task, and the test waits until Postgres reports B's
backend waiting on a lock (or B has finished) before A goes on.
"""
import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from models.note import Note
from models.tag import Tag
from models.user import User
from services.tag_service import get_or_create_tags, update_note_tags

# Ceiling for B to reach its lock wait, and for B to finish once A's
# transaction ends. Either happens within milliseconds in practice.
LOCK_WAIT_TIMEOUT = 5.0


async def _backend_pid(session: AsyncSession) -> int:
    """Return the Postgres backend PID of the session's connection."""
    return (await session.execute(text("SELECT pg_backend_pid()"))).scalar_one()


async def _wait_until_waiting_on_lock(
    factory: async_sessionmaker,
    pid: int,
    task: asyncio.Task | None = None,
) -> None:
    """
    Poll `pg_stat_activity` until the backend `pid` is waiting on a lock, or `task` has finished.

    Each poll uses a fresh session: within one transaction Postgres serves
    `pg_stat_activity` from a snapshot, so a single session would never see
    the state change.
    """
    deadline = time.monotonic() + LOCK_WAIT_TIMEOUT
    while task is None or not task.done():
        async with factory() as probe:
            wait_event_type = (
                await probe.execute(
                    text("SELECT wait_event_type FROM pg_stat_activity WHERE pid = :pid"),
                    {"pid": pid},
                )
            ).scalar_one_or_none()
        if wait_event_type == "Lock":
            return
        if time.monotonic() > deadline:
            raise AssertionError(
                f"backend {pid} never waited on a lock (last wait_event_type: {wait_event_type})",
            )
        await asyncio.sleep(0.01)


@asynccontextmanager
async def _settled(task: asyncio.Task, blocker: AsyncSession) -> AsyncIterator[asyncio.Task]:
    """
    Yield `task`; on exit, end `blocker`'s transaction if `task` is still running, then await it.

    Without this, a failing test closes B's session while B's task is still
    blocked on A. B's transaction then stays open and the fixture's cleanup
    (deleting the user) waits on it forever instead of the test failing.
    """
    try:
        yield task
    finally:
        if not task.done():
            await blocker.rollback()
        await asyncio.gather(task, return_exceptions=True)


async def _tag_rows(factory: async_sessionmaker, user_id: UUID, name: str) -> list[UUID]:
    """Return the IDs of the committed tag rows with this name for this user."""
    async with factory() as session:
        result = await session.execute(
            select(Tag.id).where(Tag.user_id == user_id, Tag.name == name),
        )
        return list(result.scalars())


async def test__get_or_create_tags__concurrent_creation_of_same_tag_both_succeed(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    B creates the same new tag while A's creation is uncommitted; A commits.

    Both calls succeed, B gets A's tag, and one row exists. Before the fix, B's
    insert raised IntegrityError on `uq_tags_user_id_name` once A committed.
    """
    user_id = concurrent_test_user.id
    async with concurrent_session_factory() as session_a, concurrent_session_factory() as session_b:
        tags_a = await get_or_create_tags(session_a, user_id, ["race-tag"])
        b_pid = await _backend_pid(session_b)
        # B also asks for a tag nobody else creates, to check the order it returns.
        b_call = get_or_create_tags(session_b, user_id, ["race-tag", "b-only-tag"])
        async with _settled(asyncio.create_task(b_call), session_a) as b_task:
            await _wait_until_waiting_on_lock(concurrent_session_factory, b_pid)
            await session_a.commit()
            tags_b = await asyncio.wait_for(b_task, LOCK_WAIT_TIMEOUT)
        await session_b.commit()

    assert [tag.name for tag in tags_b] == ["race-tag", "b-only-tag"]
    assert tags_b[0].id == tags_a[0].id
    assert await _tag_rows(concurrent_session_factory, user_id, "race-tag") == [tags_a[0].id]
    assert await _tag_rows(concurrent_session_factory, user_id, "b-only-tag") == [tags_b[1].id]


async def test__get_or_create_tags__concurrent_creator_rolls_back__other_creates_tag(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    B creates the same new tag while A's creation is uncommitted; A rolls back.

    B's call creates the tag itself and returns the row it created.
    """
    user_id = concurrent_test_user.id
    async with concurrent_session_factory() as session_a, concurrent_session_factory() as session_b:
        await get_or_create_tags(session_a, user_id, ["race-tag"])
        b_pid = await _backend_pid(session_b)
        b_call = get_or_create_tags(session_b, user_id, ["race-tag"])
        async with _settled(asyncio.create_task(b_call), session_a) as b_task:
            await _wait_until_waiting_on_lock(concurrent_session_factory, b_pid)
            await session_a.rollback()
            tags_b = await asyncio.wait_for(b_task, LOCK_WAIT_TIMEOUT)
        await session_b.commit()

    assert [tag.name for tag in tags_b] == ["race-tag"]
    assert await _tag_rows(concurrent_session_factory, user_id, "race-tag") == [tags_b[0].id]


async def test__get_or_create_tags__concurrent_creation_is_scoped_per_user(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    Two users creating the same new tag name at once don't block each other.

    The other user's transaction holds its uncommitted tag; this user's call
    still returns at once, and each user ends with their own row.
    """
    user_id = concurrent_test_user.id
    async with concurrent_session_factory() as session:
        other_user = User(
            external_auth_id=f"concurrent-test-other-{user_id}",
            email=f"other-{user_id}@test.local",
        )
        session.add(other_user)
        await session.commit()
    try:
        async with (
            concurrent_session_factory() as session_a,
            concurrent_session_factory() as session_b,
        ):
            other_tags = await get_or_create_tags(session_a, other_user.id, ["race-tag"])
            # Not blocked: a different user's row is a different key.
            tags = await asyncio.wait_for(
                get_or_create_tags(session_b, user_id, ["race-tag"]),
                LOCK_WAIT_TIMEOUT,
            )
            await session_b.commit()
            await session_a.commit()

        assert tags[0].id != other_tags[0].id
        assert tags[0].user_id == user_id
        assert await _tag_rows(concurrent_session_factory, user_id, "race-tag") == [tags[0].id]
        async with concurrent_session_factory() as session:
            total = await session.scalar(
                select(func.count()).select_from(Tag).where(
                    Tag.user_id.in_([user_id, other_user.id]),
                    Tag.name == "race-tag",
                ),
            )
        assert total == 2
    finally:
        async with concurrent_session_factory() as session:
            await session.execute(
                text("DELETE FROM users WHERE id = :uid"),
                {"uid": other_user.id},
            )
            await session.commit()


async def test__get_or_create_tags__concurrent_edits_of_one_note_adding_different_new_tags(
    concurrent_session_factory: async_sessionmaker,
    concurrent_test_user: User,
) -> None:
    """
    Two concurrent edits of one note, each adding a different new tag, both succeed.

    A adds a new tag and then writes the note's row, as every update does at the
    end (`updated_at`). B changes the title and adds a different new tag while
    A's transaction is open, and commits inside its task, as a request does at
    its end. Neither waits on the other's new tag, so they can't deadlock; a
    change that made new-tag creation wait across requests (a per-user lock,
    say) deadlocks here.
    """
    user_id = concurrent_test_user.id
    async with concurrent_session_factory() as session:
        note = Note(user_id=user_id, title="Original title")
        session.add(note)
        await session.commit()
        note_id = note.id

    async with concurrent_session_factory() as session_a, concurrent_session_factory() as session_b:
        await get_or_create_tags(session_a, user_id, ["alpha"])
        b_pid = await _backend_pid(session_b)
        note_b = (
            await session_b.execute(
                select(Note).options(selectinload(Note.tag_objects)).where(Note.id == note_id),
            )
        ).scalar_one()

        async def b_edits_title_and_adds_tag() -> None:
            note_b.title = "Edited by B"
            await update_note_tags(session_b, note_b, ["beta"])
            await session_b.commit()

        async with _settled(asyncio.create_task(b_edits_title_and_adds_tag()), session_a) as b_task:
            await _wait_until_waiting_on_lock(concurrent_session_factory, b_pid, b_task)
            await asyncio.wait_for(
                session_a.execute(
                    update(Note).where(Note.id == note_id).values(updated_at=func.clock_timestamp()),
                ),
                LOCK_WAIT_TIMEOUT,
            )
            await session_a.commit()
            await asyncio.wait_for(b_task, LOCK_WAIT_TIMEOUT)

    async with concurrent_session_factory() as session:
        saved = (
            await session.execute(
                select(Note).options(selectinload(Note.tag_objects)).where(Note.id == note_id),
            )
        ).scalar_one()
    assert saved.title == "Edited by B"
    assert [tag.name for tag in saved.tag_objects] == ["beta"]
    assert len(await _tag_rows(concurrent_session_factory, user_id, "alpha")) == 1
