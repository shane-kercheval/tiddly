"""Tests for user creation defaults."""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.content_filter import ContentFilter
from core.auth import get_or_create_user
from services import user_service


async def _get_user_filters(db_session: AsyncSession, user_id: UUID) -> list[ContentFilter]:
    result = await db_session.execute(
        select(ContentFilter).where(ContentFilter.user_id == user_id),
    )
    return list(result.scalars().all())


async def test__create_user_with_defaults__creates_default_filters(
    db_session: AsyncSession,
) -> None:
    user = await user_service.create_user_with_defaults(
        db_session,
        auth0_id="test|default-lists",
        email="default-lists@test.com",
    )

    lists = await _get_user_filters(db_session, user.id)
    names = {lst.name for lst in lists}
    assert names == {"All Bookmarks", "All Notes", "All Prompts"}
    for lst in lists:
        assert lst.filter_expression == {"groups": [], "group_operator": "OR"}
        assert lst.default_sort_by == "last_used_at"
        assert lst.default_sort_ascending is False


async def test__create_user_with_defaults__does_not_recreate_deleted_defaults(
    db_session: AsyncSession,
) -> None:
    user = await get_or_create_user(
        db_session,
        auth0_id="test|default-lists-delete",
        email="default-lists-delete@test.com",
    )

    lists = await _get_user_filters(db_session, user.id)
    assert len(lists) == 3

    await db_session.delete(lists[0])
    await db_session.flush()

    user_again = await get_or_create_user(
        db_session,
        auth0_id="test|default-lists-delete",
        email="default-lists-delete@test.com",
    )
    assert user_again.id == user.id

    lists_after = await _get_user_filters(db_session, user.id)
    assert len(lists_after) == 2
