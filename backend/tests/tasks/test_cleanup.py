"""
Comprehensive tests for the cleanup task.

These tests verify the cleanup logic handles all edge cases correctly
since this is critical code that deletes production user data.
"""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import AuthType, RequestSource
from core.tier_limits import TIER_LIMITS, Tier
from models.bookmark import Bookmark
from models.content_history import ActionType, ContentHistory, DiffType, EntityType
from models.note import Note
from models.prompt import Prompt
from models.user import User
from tasks.cleanup import (
    SOFT_DELETE_EXPIRY_DAYS,
    CleanupStats,
    cleanup_expired_history,
    cleanup_orphaned_history,
    cleanup_soft_deleted_items,
    run_cleanup,
)


# Get retention days from actual config for accurate boundary testing
FREE_RETENTION_DAYS = TIER_LIMITS[Tier.FREE].history_retention_days


def create_history_record(
    user_id,
    entity_type: EntityType,
    entity_id,
    version: int = 1,
    created_at: datetime | None = None,
) -> ContentHistory:
    """Helper to create a ContentHistory record with minimal required fields."""
    return ContentHistory(
        user_id=user_id,
        entity_type=entity_type.value,
        entity_id=entity_id,
        action=ActionType.CREATE.value,
        version=version,
        diff_type=DiffType.SNAPSHOT.value,
        content_snapshot=f"Content v{version}",
        metadata_snapshot={"title": f"Test v{version}"},
        source=RequestSource.WEB.value,
        auth_type=AuthType.AUTH0.value,
        created_at=created_at,
    )


async def count_history_records(db: AsyncSession, user_id=None) -> int:
    """Count history records, optionally filtered by user."""
    stmt = select(func.count()).select_from(ContentHistory)
    if user_id:
        stmt = stmt.where(ContentHistory.user_id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one()


async def count_entities(db: AsyncSession, model: type, user_id=None) -> int:
    """Count entities of a given type, optionally filtered by user."""
    stmt = select(func.count()).select_from(model)
    if user_id:
        stmt = stmt.where(model.user_id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one()


class TestCleanupSoftDeletedItems:
    """Tests for permanent deletion of expired soft-deleted items."""

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-softdel-{uuid4()}",
            email=f"softdel-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__day_29__soft_deleted_item_kept(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Soft-deleted item 29 days ago should be kept."""
        now = datetime.now(UTC)

        # Create note soft-deleted 29 days ago
        note = Note(
            user_id=user.id,
            title="Recently Deleted",
            content="Content",
            deleted_at=now - timedelta(days=29),
        )
        db_session.add(note)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_soft_deleted_items(db_session, now=now)

        # Note should still exist
        assert stats.soft_deleted_expired == 0
        assert await count_entities(db_session, Note, user.id) == 1

    @pytest.mark.asyncio
    async def test__day_30_exactly__soft_deleted_item_kept(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Soft-deleted item exactly 30 days ago should be kept (boundary)."""
        now = datetime.now(UTC)

        note = Note(
            user_id=user.id,
            title="Exactly 30 Days",
            content="Content",
            deleted_at=now - timedelta(days=SOFT_DELETE_EXPIRY_DAYS),
        )
        db_session.add(note)
        await db_session.commit()

        stats = await cleanup_soft_deleted_items(db_session, now=now)

        assert stats.soft_deleted_expired == 0
        assert await count_entities(db_session, Note, user.id) == 1

    @pytest.mark.asyncio
    async def test__day_30_plus_1_second__soft_deleted_item_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Soft-deleted item 30 days + 1 second ago should be permanently deleted."""
        now = datetime.now(UTC)

        note = Note(
            user_id=user.id,
            title="Just Past Expiry",
            content="Content",
            deleted_at=now - timedelta(days=SOFT_DELETE_EXPIRY_DAYS, seconds=1),
        )
        db_session.add(note)
        await db_session.flush()

        # Add history for the note
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        await db_session.commit()

        stats = await cleanup_soft_deleted_items(db_session, now=now)

        # Note and history should be deleted
        assert stats.soft_deleted_expired == 1
        assert stats.soft_deleted_by_type["notes"] == 1
        assert await count_entities(db_session, Note, user.id) == 0
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__day_31__soft_deleted_item_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Soft-deleted item 31 days ago should be permanently deleted."""
        now = datetime.now(UTC)

        note = Note(
            user_id=user.id,
            title="Expired",
            content="Content",
            deleted_at=now - timedelta(days=31),
        )
        db_session.add(note)
        await db_session.commit()

        stats = await cleanup_soft_deleted_items(db_session, now=now)

        assert stats.soft_deleted_expired == 1
        assert await count_entities(db_session, Note, user.id) == 0

    @pytest.mark.asyncio
    async def test__all_entity_types__cleaned_correctly(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Expired soft-deleted bookmarks, notes, and prompts are all cleaned."""
        now = datetime.now(UTC)
        expired_time = now - timedelta(days=60)

        # Create expired soft-deleted entities of each type
        note = Note(
            user_id=user.id,
            title="Deleted Note",
            content="Content",
            deleted_at=expired_time,
        )
        bookmark = Bookmark(
            user_id=user.id,
            url="https://example.com",
            deleted_at=expired_time,
        )
        prompt = Prompt(
            user_id=user.id,
            name=f"deleted-prompt-{uuid4().hex[:8]}",
            content="Content",
            deleted_at=expired_time,
        )
        db_session.add_all([note, bookmark, prompt])
        await db_session.commit()

        stats = await cleanup_soft_deleted_items(db_session, now=now)

        assert stats.soft_deleted_expired == 3
        assert stats.soft_deleted_by_type["notes"] == 1
        assert stats.soft_deleted_by_type["bookmarks"] == 1
        assert stats.soft_deleted_by_type["prompts"] == 1

    @pytest.mark.asyncio
    async def test__history_cascade_deleted_before_entity(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History is deleted before the entity (application-level cascade)."""
        now = datetime.now(UTC)

        # Create expired soft-deleted note with history
        note = Note(
            user_id=user.id,
            title="Expired With History",
            content="Content",
            deleted_at=now - timedelta(days=60),
        )
        db_session.add(note)
        await db_session.flush()

        # Add multiple history records
        for v in range(1, 4):
            db_session.add(create_history_record(
                user_id=user.id,
                entity_type=EntityType.NOTE,
                entity_id=note.id,
                version=v,
            ))
        await db_session.commit()

        # Verify setup
        assert await count_history_records(db_session, user.id) == 3

        stats = await cleanup_soft_deleted_items(db_session, now=now)

        # Both entity and all history deleted
        assert stats.soft_deleted_expired == 1
        assert await count_entities(db_session, Note, user.id) == 0
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__active_entities_not_affected(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Active (non-deleted) entities are not affected by cleanup."""
        now = datetime.now(UTC)

        # Create active note and expired soft-deleted note
        active_note = Note(
            user_id=user.id,
            title="Active Note",
            content="Active content",
        )
        deleted_note = Note(
            user_id=user.id,
            title="Deleted Note",
            content="Deleted content",
            deleted_at=now - timedelta(days=60),
        )
        db_session.add_all([active_note, deleted_note])
        await db_session.commit()

        stats = await cleanup_soft_deleted_items(db_session, now=now)

        # Only deleted note removed
        assert stats.soft_deleted_expired == 1
        assert await count_entities(db_session, Note, user.id) == 1


class TestCleanupExpiredHistoryBoundaryConditions:
    """
    Test precise boundary conditions for time-based cleanup.

    With retention_days=30:
    - Day 29: KEEP (within retention window)
    - Day 30: KEEP (exactly at boundary, created_at < cutoff means strictly less than)
    - Day 31: DELETE (outside retention window)
    """

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-boundary-{uuid4()}",
            email=f"boundary-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__day_29__record_is_kept(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Record created 29 days ago should be kept (inside retention window)."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record 29 days ago
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=now - timedelta(days=29),
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record was NOT deleted
        assert stats.expired_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__day_30_exactly__record_is_kept(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """
        Record created exactly 30 days ago should be kept.

        The cutoff is `now - 30 days`, and we delete where `created_at < cutoff`.
        A record created exactly at cutoff (created_at == cutoff) is NOT deleted.
        """
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record exactly 30 days ago
        exactly_30_days = now - timedelta(days=FREE_RETENTION_DAYS)
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=exactly_30_days,
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record was NOT deleted (exactly at boundary is kept)
        assert stats.expired_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__day_30_plus_1_second__record_is_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Record created 30 days + 1 second ago should be deleted."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record 30 days + 1 second ago
        just_past_cutoff = now - timedelta(days=FREE_RETENTION_DAYS, seconds=1)
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=just_past_cutoff,
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record WAS deleted
        assert stats.expired_deleted == 1
        assert stats.expired_by_tier[Tier.FREE.value] == 1
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__day_31__record_is_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Record created 31 days ago should be deleted (clearly outside window)."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create record 31 days ago
        record = create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=entity_id,
            created_at=now - timedelta(days=31),
        )
        db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify record WAS deleted
        assert stats.expired_deleted == 1
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__mixed_ages__only_old_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """With mixed record ages, only records past retention are deleted."""
        now = datetime.now(UTC)
        entity_id = uuid4()

        # Create records at various ages
        ages_and_expected = [
            (1, True),     # 1 day ago - keep
            (15, True),    # 15 days ago - keep
            (29, True),    # 29 days ago - keep
            (30, True),    # 30 days ago - keep (exactly at boundary)
            (31, False),   # 31 days ago - delete
            (60, False),   # 60 days ago - delete
            (365, False),  # 365 days ago - delete
        ]

        for version, (days_ago, should_keep) in enumerate(ages_and_expected, 1):
            record = create_history_record(
                user_id=user.id,
                entity_type=EntityType.NOTE,
                entity_id=entity_id,
                version=version,
                created_at=now - timedelta(days=days_ago),
            )
            db_session.add(record)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Verify: 3 deleted (days 31, 60, 365), 4 kept
        assert stats.expired_deleted == 3
        assert await count_history_records(db_session, user.id) == 4


class TestCleanupExpiredHistoryBatchByTier:
    """Test batch-by-tier cleanup behavior."""

    @pytest.mark.asyncio
    async def test__multiple_users_same_tier__single_delete(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Multiple users in same tier are cleaned with single DELETE per tier."""
        now = datetime.now(UTC)

        # Create 3 users all in FREE tier
        users = []
        for i in range(3):
            user = User(
                auth0_id=f"test-tier-{uuid4()}",
                email=f"tier-{uuid4()}@test.com",
                tier=Tier.FREE.value,
            )
            db_session.add(user)
            users.append(user)
        await db_session.flush()

        # Each user has old records
        for user in users:
            db_session.add(create_history_record(
                user_id=user.id,
                entity_type=EntityType.NOTE,
                entity_id=uuid4(),
                created_at=now - timedelta(days=60),
            ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # All 3 records deleted, tracked by tier
        assert stats.expired_deleted == 3
        assert stats.expired_by_tier[Tier.FREE.value] == 3

        # All users cleaned
        for user in users:
            assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__null_tier__treated_as_free(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Users with NULL tier are treated as FREE tier."""
        now = datetime.now(UTC)

        # Create user with NULL tier
        user = User(
            auth0_id=f"test-null-tier-{uuid4()}",
            email=f"nulltier-{uuid4()}@test.com",
            tier=None,  # NULL tier
        )
        db_session.add(user)
        await db_session.flush()

        # Add old record
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=uuid4(),
            created_at=now - timedelta(days=60),
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # Record deleted under FREE tier
        assert stats.expired_deleted == 1
        assert stats.expired_by_tier[Tier.FREE.value] == 1


class TestCleanupExpiredHistoryEntityTypes:
    """Test cleanup handles all entity types correctly."""

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-entity-{uuid4()}",
            email=f"entity-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__all_entity_types__cleaned_correctly(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """Cleanup applies to bookmark, note, and prompt history equally."""
        now = datetime.now(UTC)

        # Create old records for each entity type
        for entity_type in [EntityType.BOOKMARK, EntityType.NOTE, EntityType.PROMPT]:
            db_session.add(create_history_record(
                user_id=user.id,
                entity_type=entity_type,
                entity_id=uuid4(),
                created_at=now - timedelta(days=60),
            ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_expired_history(db_session, now=now)

        # All 3 records deleted
        assert stats.expired_deleted == 3
        assert await count_history_records(db_session, user.id) == 0


class TestCleanupOrphanedHistory:
    """Test orphaned history cleanup."""

    @pytest.fixture
    async def user(self, db_session: AsyncSession) -> User:
        """Create a test user."""
        user = User(
            auth0_id=f"test-orphan-{uuid4()}",
            email=f"orphan-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)
        return user

    @pytest.mark.asyncio
    async def test__orphaned_bookmark_history__deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for non-existent bookmark is deleted."""
        # Create orphaned history (no corresponding bookmark)
        orphan_id = uuid4()
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=orphan_id,
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # Orphan deleted
        assert stats.orphaned_deleted == 1
        assert stats.orphaned_by_entity_type[EntityType.BOOKMARK.value] == 1
        assert await count_history_records(db_session, user.id) == 0

    @pytest.mark.asyncio
    async def test__orphaned_note_history__deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for non-existent note is deleted."""
        orphan_id = uuid4()
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=orphan_id,
        ))
        await db_session.commit()

        stats = await cleanup_orphaned_history(db_session)

        assert stats.orphaned_deleted == 1
        assert stats.orphaned_by_entity_type[EntityType.NOTE.value] == 1

    @pytest.mark.asyncio
    async def test__orphaned_prompt_history__deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for non-existent prompt is deleted."""
        orphan_id = uuid4()
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.PROMPT,
            entity_id=orphan_id,
        ))
        await db_session.commit()

        stats = await cleanup_orphaned_history(db_session)

        assert stats.orphaned_deleted == 1
        assert stats.orphaned_by_entity_type[EntityType.PROMPT.value] == 1

    @pytest.mark.asyncio
    async def test__existing_entity_history__not_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """History for existing entity is NOT deleted."""
        # Create a real note
        note = Note(
            user_id=user.id,
            title="Real Note",
            content="Real content",
        )
        db_session.add(note)
        await db_session.flush()

        # Create history for the real note
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # Nothing deleted - entity exists
        assert stats.orphaned_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__soft_deleted_entity_history__not_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """
        History for soft-deleted entity is NOT deleted.

        Soft-deleted entities still exist in the database (deleted_at IS NOT NULL).
        Their history should be preserved until permanent deletion.
        """
        # Create a note and soft-delete it
        note = Note(
            user_id=user.id,
            title="Soft Deleted Note",
            content="Will be soft deleted",
        )
        db_session.add(note)
        await db_session.flush()

        # Create history for the note
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))

        # Soft delete the note
        note.deleted_at = datetime.now(UTC)
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # Nothing deleted - soft-deleted entity still exists in DB
        assert stats.orphaned_deleted == 0
        assert await count_history_records(db_session, user.id) == 1

    @pytest.mark.asyncio
    async def test__mixed_orphaned_and_valid__only_orphans_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """With mixed records, only orphaned history is deleted."""
        # Create real entities
        note = Note(user_id=user.id, title="Real", content="Content")
        bookmark = Bookmark(user_id=user.id, url="https://example.com")
        db_session.add(note)
        db_session.add(bookmark)
        await db_session.flush()

        # Create history for real entities
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=bookmark.id,
        ))

        # Create orphaned history
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=uuid4(),  # Non-existent
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.PROMPT,
            entity_id=uuid4(),  # Non-existent
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        # 2 orphans deleted, 2 valid kept
        assert stats.orphaned_deleted == 2
        assert await count_history_records(db_session, user.id) == 2

    @pytest.mark.asyncio
    async def test__no_orphans__nothing_deleted(
        self,
        db_session: AsyncSession,
        user: User,
    ) -> None:
        """When there are no orphans, nothing is deleted."""
        # Create real note with history
        note = Note(user_id=user.id, title="Real", content="Content")
        db_session.add(note)
        await db_session.flush()

        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
        ))
        await db_session.commit()

        # Run cleanup
        stats = await cleanup_orphaned_history(db_session)

        assert stats.orphaned_deleted == 0
        assert len(stats.orphaned_by_entity_type) == 0


class TestCleanupEmptyScenarios:
    """Test cleanup handles empty scenarios correctly."""

    @pytest.mark.asyncio
    async def test__no_users__completes_without_error(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Cleanup completes successfully when there are no users."""
        # Run cleanup on empty-ish database
        stats = await cleanup_expired_history(db_session, now=datetime.now(UTC))

        # Should complete without error
        assert stats.expired_deleted == 0

    @pytest.mark.asyncio
    async def test__no_history_records__completes_without_error(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Cleanup completes successfully when there's no history."""
        # Create user but no history
        user = User(
            auth0_id=f"test-nohistory-{uuid4()}",
            email=f"nohistory-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.commit()

        # Run both cleanups
        expired_stats = await cleanup_expired_history(db_session, now=datetime.now(UTC))
        orphan_stats = await cleanup_orphaned_history(db_session)

        assert expired_stats.expired_deleted == 0
        assert orphan_stats.orphaned_deleted == 0

    @pytest.mark.asyncio
    async def test__no_soft_deleted_items__completes_without_error(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Soft-delete cleanup completes when there are no soft-deleted items."""
        # Create active note (not deleted)
        user = User(
            auth0_id=f"test-active-{uuid4()}",
            email=f"active-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.flush()

        note = Note(user_id=user.id, title="Active", content="Content")
        db_session.add(note)
        await db_session.commit()

        stats = await cleanup_soft_deleted_items(db_session, now=datetime.now(UTC))

        assert stats.soft_deleted_expired == 0


class TestRunCleanupIntegration:
    """Integration tests for the full cleanup flow."""

    @pytest.mark.asyncio
    async def test__run_cleanup__executes_all_cleanup_types(
        self,
        db_session: AsyncSession,
    ) -> None:
        """run_cleanup executes soft-delete, expired, and orphan cleanup."""
        now = datetime.now(UTC)

        # Create user
        user = User(
            auth0_id=f"test-integration-{uuid4()}",
            email=f"integration-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.flush()

        # Create real note
        note = Note(user_id=user.id, title="Real", content="Content")
        db_session.add(note)
        await db_session.flush()

        # Create expired soft-deleted note
        deleted_note = Note(
            user_id=user.id,
            title="Deleted",
            content="Content",
            deleted_at=now - timedelta(days=60),
        )
        db_session.add(deleted_note)
        await db_session.flush()

        # Create history: 1 old record (expired), 1 new record (keep), 1 orphan
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
            version=1,
            created_at=now - timedelta(days=60),  # Old - delete
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=note.id,
            version=2,
            created_at=now - timedelta(days=5),  # New - keep
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.BOOKMARK,
            entity_id=uuid4(),  # Orphan - delete
        ))
        # History for the deleted note
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=deleted_note.id,
        ))
        await db_session.commit()

        # Run full cleanup
        stats = await run_cleanup(db=db_session, now=now)

        # Verify combined results
        assert stats.soft_deleted_expired == 1  # The deleted note
        assert stats.expired_deleted == 1  # One old history record
        assert stats.orphaned_deleted == 1  # One orphan

        # Only the new, valid record remains
        assert await count_history_records(db_session, user.id) == 1
        # Only the active note remains
        assert await count_entities(db_session, Note, user.id) == 1

    @pytest.mark.asyncio
    async def test__run_cleanup__order_matters(
        self,
        db_session: AsyncSession,
    ) -> None:
        """
        Soft-delete cleanup runs first, so its history is deleted before
        expired history cleanup, preventing double-counting.
        """
        now = datetime.now(UTC)

        user = User(
            auth0_id=f"test-order-{uuid4()}",
            email=f"order-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.flush()

        # Create expired soft-deleted note with old history
        deleted_note = Note(
            user_id=user.id,
            title="Deleted",
            content="Content",
            deleted_at=now - timedelta(days=60),
        )
        db_session.add(deleted_note)
        await db_session.flush()

        # This history is old AND belongs to a soft-deleted entity
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.NOTE,
            entity_id=deleted_note.id,
            created_at=now - timedelta(days=60),
        ))
        await db_session.commit()

        stats = await run_cleanup(db=db_session, now=now)

        # Soft-delete cleanup handles the entity and its history
        assert stats.soft_deleted_expired == 1
        # Expired cleanup doesn't double-count (history already deleted)
        assert stats.expired_deleted == 0

    @pytest.mark.asyncio
    async def test__run_cleanup__stats_breakdown_is_accurate(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Verify detailed breakdown in stats matches actual deletions."""
        now = datetime.now(UTC)

        user = User(
            auth0_id=f"test-breakdown-{uuid4()}",
            email=f"breakdown-{uuid4()}@test.com",
            tier=Tier.FREE.value,
        )
        db_session.add(user)
        await db_session.flush()

        # Create 3 old history records
        for v in range(1, 4):
            db_session.add(create_history_record(
                user_id=user.id,
                entity_type=EntityType.NOTE,
                entity_id=uuid4(),
                version=v,
                created_at=now - timedelta(days=60),
            ))

        # Add orphans of different types
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.PROMPT,
            entity_id=uuid4(),
        ))
        db_session.add(create_history_record(
            user_id=user.id,
            entity_type=EntityType.PROMPT,
            entity_id=uuid4(),
        ))

        # Create expired soft-deleted items
        for _ in range(2):
            note = Note(
                user_id=user.id,
                title="Deleted",
                content="Content",
                deleted_at=now - timedelta(days=60),
            )
            db_session.add(note)
        await db_session.commit()

        # Run full cleanup
        stats = await run_cleanup(db=db_session, now=now)

        # Verify soft-delete breakdown
        assert stats.soft_deleted_expired == 2
        assert stats.soft_deleted_by_type["notes"] == 2

        # Verify expired breakdown
        assert stats.expired_by_tier[Tier.FREE.value] == 3
        assert stats.expired_deleted == 3

        # Verify orphan breakdown
        assert stats.orphaned_by_entity_type[EntityType.PROMPT.value] == 2
        assert stats.orphaned_deleted == 2


class TestCleanupStatsDataclass:
    """Tests for the CleanupStats dataclass."""

    def test__to_dict__returns_summary(self) -> None:
        """to_dict returns a simple summary dict."""
        stats = CleanupStats(
            soft_deleted_expired=2,
            expired_deleted=5,
            orphaned_deleted=3,
            soft_deleted_by_type={"notes": 1, "bookmarks": 1},
            expired_by_tier={"free": 5},
            orphaned_by_entity_type={"note": 2, "bookmark": 1},
        )

        result = stats.to_dict()

        assert result == {
            "soft_deleted_expired": 2,
            "expired_deleted": 5,
            "orphaned_deleted": 3,
        }
        # Detailed breakdowns not in summary
        assert "soft_deleted_by_type" not in result
        assert "expired_by_tier" not in result
        assert "orphaned_by_entity_type" not in result

    def test__default_values__are_empty(self) -> None:
        """Default CleanupStats has zero counts and empty dicts."""
        stats = CleanupStats()

        assert stats.soft_deleted_expired == 0
        assert stats.expired_deleted == 0
        assert stats.orphaned_deleted == 0
        assert stats.soft_deleted_by_type == {}
        assert stats.expired_by_tier == {}
        assert stats.orphaned_by_entity_type == {}
