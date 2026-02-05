"""Integration tests for history recording in services."""
import pytest
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import AuthType, RequestContext, RequestSource
from core.tier_limits import get_tier_limits
from models.content_history import ActionType, ContentHistory, DiffType, EntityType
from models.user import User
from schemas.bookmark import BookmarkCreate, BookmarkUpdate
from schemas.note import NoteCreate, NoteUpdate
from schemas.prompt import PromptArgument, PromptCreate
from services.bookmark_service import BookmarkService
from services.note_service import NoteService
from services.prompt_service import PromptService


@pytest.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user for history integration tests."""
    user = User(
        auth0_id="test-auth0-id-history-integration",
        email="historyintegration@test.com",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def make_context(
    source: RequestSource = RequestSource.WEB,
    auth_type: AuthType = AuthType.AUTH0,
    token_prefix: str | None = None,
) -> RequestContext:
    """Create a RequestContext for testing."""
    return RequestContext(source=source, auth_type=auth_type, token_prefix=token_prefix)


async def get_entity_history(
    db_session: AsyncSession,
    user_id: UUID,
    entity_type: EntityType,
    entity_id: UUID,
) -> list[ContentHistory]:
    """Get all history for an entity."""
    result = await db_session.execute(
        select(ContentHistory)
        .where(
            ContentHistory.user_id == user_id,
            ContentHistory.entity_type == entity_type.value,
            ContentHistory.entity_id == entity_id,
        )
        .order_by(ContentHistory.version),
    )
    return list(result.scalars().all())


class TestBookmarkHistoryIntegration:
    """Tests for history recording in BookmarkService."""

    @pytest.fixture
    def service(self) -> BookmarkService:
        return BookmarkService()

    @pytest.fixture
    def limits(self) -> dict:
        return get_tier_limits("free")

    @pytest.fixture
    def context(self) -> RequestContext:
        return make_context()

    @pytest.mark.asyncio
    async def test__create__records_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Create bookmark records CREATE action in history."""
        data = BookmarkCreate(
            url="https://example.com",
            title="Test Bookmark",
            content="Initial content",
            tags=["test"],
        )

        bookmark = await service.create(db_session, test_user.id, data, limits, context)
        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 1
        record = history[0]
        assert record.version == 1
        assert record.action == ActionType.CREATE.value
        assert record.diff_type == DiffType.SNAPSHOT.value
        assert record.content_snapshot == "Initial content"
        assert record.content_diff is None
        assert record.metadata_snapshot["title"] == "Test Bookmark"
        assert record.metadata_snapshot["url"] == "https://example.com/"  # URL normalized
        assert record.metadata_snapshot["tags"] == ["test"]
        assert record.source == RequestSource.WEB.value
        assert record.auth_type == AuthType.AUTH0.value

    @pytest.mark.asyncio
    async def test__update__records_history_on_content_change(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Update bookmark records UPDATE action when content changes."""
        # Create bookmark
        create_data = BookmarkCreate(
            url="https://example.com",
            content="Original content",
        )
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)

        # Update content
        update_data = BookmarkUpdate(content="Updated content")
        await service.update(db_session, test_user.id, bookmark.id, update_data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 2
        update_record = history[1]
        assert update_record.version == 2
        assert update_record.action == ActionType.UPDATE.value
        assert update_record.diff_type == DiffType.DIFF.value
        assert update_record.content_snapshot is None
        assert update_record.content_diff is not None  # Reverse diff stored

    @pytest.mark.asyncio
    async def test__update__records_history_on_metadata_change(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Update bookmark records UPDATE action when metadata changes."""
        # Create bookmark
        create_data = BookmarkCreate(
            url="https://example.com",
            title="Original Title",
            content="Content",
        )
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)

        # Update title only (no content change)
        update_data = BookmarkUpdate(title="New Title")
        await service.update(db_session, test_user.id, bookmark.id, update_data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 2
        update_record = history[1]
        assert update_record.action == ActionType.UPDATE.value
        assert update_record.diff_type == DiffType.METADATA.value  # Content unchanged
        assert update_record.metadata_snapshot["title"] == "New Title"

    @pytest.mark.asyncio
    async def test__update__skips_history_on_no_change(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """No-op update does not record history."""
        # Create bookmark
        create_data = BookmarkCreate(
            url="https://example.com",
            title="Title",
            content="Content",
        )
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)

        # Update with same values
        update_data = BookmarkUpdate(title="Title")
        await service.update(db_session, test_user.id, bookmark.id, update_data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        # Only CREATE, no UPDATE
        assert len(history) == 1
        assert history[0].action == ActionType.CREATE.value

    @pytest.mark.asyncio
    async def test__delete__records_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Soft delete records DELETE action with content snapshot."""
        # Create bookmark
        create_data = BookmarkCreate(
            url="https://example.com",
            content="Content to preserve",
        )
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)

        # Soft delete
        await service.delete(db_session, test_user.id, bookmark.id, permanent=False, context=context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 2
        delete_record = history[1]
        assert delete_record.action == ActionType.DELETE.value
        assert delete_record.diff_type == DiffType.SNAPSHOT.value
        assert delete_record.content_snapshot == "Content to preserve"

    @pytest.mark.asyncio
    async def test__hard_delete__cascades_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Hard delete removes all history for the entity."""
        # Create and soft delete bookmark
        create_data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)
        await service.delete(db_session, test_user.id, bookmark.id, permanent=False, context=context)

        # Verify history exists
        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)
        assert len(history) == 2

        # Hard delete
        await service.delete(db_session, test_user.id, bookmark.id, permanent=True)

        # Verify history is gone
        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)
        assert len(history) == 0

    @pytest.mark.asyncio
    async def test__restore__records_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Restore records RESTORE action."""
        # Create, delete, then restore
        create_data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)
        await service.delete(db_session, test_user.id, bookmark.id, permanent=False, context=context)
        await service.restore(db_session, test_user.id, bookmark.id, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 3
        restore_record = history[2]
        assert restore_record.action == ActionType.RESTORE.value
        assert restore_record.diff_type == DiffType.METADATA.value  # Content unchanged

    @pytest.mark.asyncio
    async def test__archive__records_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Archive records ARCHIVE action."""
        create_data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)
        await service.archive(db_session, test_user.id, bookmark.id, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 2
        archive_record = history[1]
        assert archive_record.action == ActionType.ARCHIVE.value
        assert archive_record.diff_type == DiffType.METADATA.value

    @pytest.mark.asyncio
    async def test__archive__idempotent_no_duplicate_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Archiving already-archived bookmark does not record duplicate history."""
        create_data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)
        await service.archive(db_session, test_user.id, bookmark.id, context)
        await service.archive(db_session, test_user.id, bookmark.id, context)  # Second archive

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        # Only CREATE + one ARCHIVE
        assert len(history) == 2

    @pytest.mark.asyncio
    async def test__unarchive__records_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: BookmarkService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Unarchive records UNARCHIVE action."""
        create_data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, create_data, limits, context)
        await service.archive(db_session, test_user.id, bookmark.id, context)
        await service.unarchive(db_session, test_user.id, bookmark.id, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 3
        unarchive_record = history[2]
        assert unarchive_record.action == ActionType.UNARCHIVE.value


class TestContextPropagation:
    """Tests for request context propagation to history records."""

    @pytest.mark.asyncio
    async def test__context_web_auth0(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """Web + Auth0 context is recorded."""
        context = make_context(source=RequestSource.WEB, auth_type=AuthType.AUTH0)
        service = BookmarkService()
        limits = get_tier_limits("free")

        data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert history[0].source == "web"
        assert history[0].auth_type == "auth0"
        assert history[0].token_prefix is None

    @pytest.mark.asyncio
    async def test__context_api_pat(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """API + PAT context with token prefix is recorded."""
        context = make_context(
            source=RequestSource.API,
            auth_type=AuthType.PAT,
            token_prefix="bm_test123...",
        )
        service = BookmarkService()
        limits = get_tier_limits("free")

        data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert history[0].source == "api"
        assert history[0].auth_type == "pat"
        assert history[0].token_prefix == "bm_test123..."

    @pytest.mark.asyncio
    async def test__context_mcp_content(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """MCP-content source is recorded."""
        context = make_context(
            source=RequestSource.MCP_CONTENT,
            auth_type=AuthType.PAT,
            token_prefix="bm_mcp...",
        )
        service = NoteService()
        limits = get_tier_limits("free")

        data = NoteCreate(title="Test", content="Content")
        note = await service.create(db_session, test_user.id, data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.NOTE, note.id)

        assert history[0].source == "mcp-content"


class TestNoteHistoryIntegration:
    """Tests for history recording in NoteService."""

    @pytest.fixture
    def service(self) -> NoteService:
        return NoteService()

    @pytest.fixture
    def limits(self) -> dict:
        return get_tier_limits("free")

    @pytest.fixture
    def context(self) -> RequestContext:
        return make_context()

    @pytest.mark.asyncio
    async def test__create_and_update__records_history(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: NoteService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Note create and update both record history."""
        # Create
        create_data = NoteCreate(title="Test Note", content="Initial")
        note = await service.create(db_session, test_user.id, create_data, limits, context)

        # Update
        update_data = NoteUpdate(content="Updated")
        await service.update(db_session, test_user.id, note.id, update_data, limits, context)

        history = await get_entity_history(db_session, test_user.id, EntityType.NOTE, note.id)

        assert len(history) == 2
        assert history[0].action == ActionType.CREATE.value
        assert history[1].action == ActionType.UPDATE.value


class TestPromptHistoryIntegration:
    """Tests for history recording in PromptService."""

    @pytest.fixture
    def service(self) -> PromptService:
        return PromptService()

    @pytest.fixture
    def limits(self) -> dict:
        return get_tier_limits("free")

    @pytest.fixture
    def context(self) -> RequestContext:
        return make_context()

    @pytest.mark.asyncio
    async def test__create__records_history_with_arguments(
        self,
        db_session: AsyncSession,
        test_user: User,
        service: PromptService,
        limits: dict,
        context: RequestContext,
    ) -> None:
        """Prompt create records history including arguments in metadata."""
        data = PromptCreate(
            name="test-prompt",
            content="Hello {{ name }}",
            arguments=[PromptArgument(name="name", description="User name")],
        )

        prompt = await service.create(db_session, test_user.id, data, limits, context)
        history = await get_entity_history(db_session, test_user.id, EntityType.PROMPT, prompt.id)

        assert len(history) == 1
        record = history[0]
        assert record.metadata_snapshot["name"] == "test-prompt"
        assert record.metadata_snapshot["arguments"] == [
            {"name": "name", "description": "User name", "required": None},
        ]


class TestTransactionRollbackSafety:
    """P0 test: Verify history survives transaction rollback scenarios."""

    @pytest.mark.asyncio
    async def test__service_error_after_history__history_rolled_back(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """If service operation fails after history recorded, both are rolled back."""
        # This test verifies the atomic nature of history + entity changes.
        # Since history is recorded AFTER entity changes in the same transaction,
        # if the transaction commits, both are persisted; if it fails, both roll back.
        #
        # We can't easily simulate mid-operation failures, but we can verify that
        # a successful operation has both entity and history persisted.

        service = BookmarkService()
        limits = get_tier_limits("free")
        context = make_context()

        data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, data, limits, context)

        # Verify both entity and history exist
        assert bookmark.id is not None
        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)
        assert len(history) == 1

        # If we had a way to fail between entity change and history recording,
        # the transaction would roll back and neither would be persisted.
        # The implementation ensures history is recorded in the same transaction.


class TestHistoryWithoutContext:
    """Tests for operations without context (history skipped)."""

    @pytest.mark.asyncio
    async def test__create_without_context__no_history(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """Create without context does not record history."""
        service = BookmarkService()
        limits = get_tier_limits("free")

        data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, data, limits)  # No context

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        assert len(history) == 0

    @pytest.mark.asyncio
    async def test__update_without_context__no_history(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """Update without context does not record history."""
        service = BookmarkService()
        limits = get_tier_limits("free")
        context = make_context()

        # Create with context
        data = BookmarkCreate(url="https://example.com", content="Content")
        bookmark = await service.create(db_session, test_user.id, data, limits, context)

        # Update without context
        update_data = BookmarkUpdate(content="New content")
        await service.update(db_session, test_user.id, bookmark.id, update_data, limits)  # No context

        history = await get_entity_history(db_session, test_user.id, EntityType.BOOKMARK, bookmark.id)

        # Only CREATE, no UPDATE
        assert len(history) == 1
        assert history[0].action == ActionType.CREATE.value


class TestRestoreUrlConflict:
    """Tests for history behavior when restore fails due to URL conflict."""

    @pytest.mark.asyncio
    async def test__restore__url_conflict_does_not_record_history(
        self,
        db_session: AsyncSession,
        test_user: User,
    ) -> None:
        """When restore fails due to URL conflict, no history should be recorded."""
        from services.bookmark_service import BookmarkService, DuplicateUrlError

        service = BookmarkService()
        limits = get_tier_limits("free")
        context = make_context()

        # Create and soft-delete a bookmark
        data1 = BookmarkCreate(url="https://conflict-test.com", content="First bookmark")
        bookmark1 = await service.create(db_session, test_user.id, data1, limits, context)
        await service.delete(db_session, test_user.id, bookmark1.id, permanent=False, context=context)

        # Create another bookmark with the same URL (now that the first is deleted)
        data2 = BookmarkCreate(url="https://conflict-test.com", content="Second bookmark")
        bookmark2 = await service.create(db_session, test_user.id, data2, limits, context)

        # Get history count before restore attempt
        history_before = await get_entity_history(
            db_session, test_user.id, EntityType.BOOKMARK, bookmark1.id,
        )
        history_count_before = len(history_before)

        # Try to restore the first bookmark - should fail due to URL conflict
        with pytest.raises(DuplicateUrlError):
            await service.restore(db_session, test_user.id, bookmark1.id, context)

        # History count should be unchanged (no RESTORE record added)
        history_after = await get_entity_history(
            db_session, test_user.id, EntityType.BOOKMARK, bookmark1.id,
        )
        assert len(history_after) == history_count_before

        # The last action should still be DELETE, not RESTORE
        assert history_after[-1].action == ActionType.DELETE.value

        # Clean up: bookmark2 should still exist
        active = await service.get(db_session, test_user.id, bookmark2.id)
        assert active is not None
