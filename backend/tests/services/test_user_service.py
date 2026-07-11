"""
Tests for user creation defaults and the identity invariant.

Note: Imports from core.auth are done inside test methods to avoid triggering
Settings validation during test collection (before DATABASE_URL is set by fixtures).
"""
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.content_filter import ContentFilter
from models.user import User
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
    from core.auth import get_or_create_user  # noqa: PLC0415

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


class TestIdentityInvariant:
    """Every user row carries at least one provider identity (dual-accept window)."""

    async def test__auth0_keyed_creation__external_auth_id_null(
        self,
        db_session: AsyncSession,
    ) -> None:
        user = await user_service.create_user_with_defaults(
            db_session, auth0_id="test|invariant-auth0",
        )
        assert user.auth0_id == "test|invariant-auth0"
        assert user.external_auth_id is None

    async def test__clerk_keyed_creation__auth0_id_null(
        self,
        db_session: AsyncSession,
    ) -> None:
        user = await user_service.create_user_with_defaults(
            db_session, external_auth_id="user_invariant_clerk",
        )
        assert user.external_auth_id == "user_invariant_clerk"
        assert user.auth0_id is None

    async def test__no_identifier__service_layer_rejects(
        self,
        db_session: AsyncSession,
    ) -> None:
        with pytest.raises(ValueError, match="Exactly one"):
            await user_service.create_user_with_defaults(db_session)

    async def test__both_identifiers__service_layer_rejects(
        self,
        db_session: AsyncSession,
    ) -> None:
        """
        JIT paths never supply both; the import script writes the second
        identifier onto an existing row instead of creating with both.
        """
        with pytest.raises(ValueError, match="Exactly one"):
            await user_service.create_user_with_defaults(
                db_session, auth0_id="test|both", external_auth_id="user_both",
            )

    async def test__both_null__database_check_rejects(
        self,
        db_session: AsyncSession,
    ) -> None:
        """
        A row with neither identity is impossible even bypassing the service
        layer — the ck_user_has_identity CHECK raises.
        """
        db_session.add(User(email="noid@test.com"))
        with pytest.raises(IntegrityError, match="ck_user_has_identity"):
            await db_session.flush()
        await db_session.rollback()
