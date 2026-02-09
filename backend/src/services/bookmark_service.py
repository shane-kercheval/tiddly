"""Service layer for bookmark CRUD operations."""
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.request_context import RequestContext
from core.tier_limits import TierLimits
from models.bookmark import Bookmark
from models.content_history import ActionType, EntityType
from models.tag import bookmark_tags
from schemas.bookmark import BookmarkCreate, BookmarkUpdate
from services.base_entity_service import BaseEntityService
from services.exceptions import FieldLimitExceededError, InvalidStateError, QuotaExceededError
from services.tag_service import get_or_create_tags, update_bookmark_tags

logger = logging.getLogger(__name__)


class DuplicateUrlError(Exception):
    """Raised when a bookmark with the same URL already exists for the user."""

    def __init__(self, url: str) -> None:
        self.url = url
        super().__init__(f"A bookmark with URL '{url}' already exists")


class ArchivedUrlExistsError(Exception):
    """Raised when trying to create a bookmark but URL exists as archived."""

    def __init__(self, url: str, existing_bookmark_id: UUID) -> None:
        self.url = url
        self.existing_bookmark_id = existing_bookmark_id
        super().__init__(f"A bookmark with URL '{url}' exists in archive")


class BookmarkService(BaseEntityService[Bookmark]):
    """
    Bookmark service with full CRUD operations.

    Extends BaseEntityService with bookmark-specific:
    - Text search fields (includes url, summary)
    - Sort columns (title falls back to url)
    - URL uniqueness checks in create/update/restore
    """

    model = Bookmark
    junction_table = bookmark_tags
    entity_name = "Bookmark"

    @property
    def entity_type(self) -> EntityType:
        """Return the EntityType for bookmarks."""
        return EntityType.BOOKMARK

    def _get_metadata_snapshot(self, entity: Bookmark) -> dict:
        """Extract bookmark metadata including URL."""
        base = super()._get_metadata_snapshot(entity)
        base["url"] = entity.url
        return base

    def _build_text_search_filter(self, pattern: str) -> list:
        """Build text search filter for bookmark fields."""
        return [
            or_(
                Bookmark.title.ilike(pattern),
                Bookmark.description.ilike(pattern),
                Bookmark.url.ilike(pattern),
                Bookmark.summary.ilike(pattern),
                Bookmark.content.ilike(pattern),
            ),
        ]

    def _get_sort_columns(self) -> dict[str, ColumnElement[Any]]:
        """Get sort columns with title falling back to URL."""
        return {
            "created_at": Bookmark.created_at,
            "updated_at": Bookmark.updated_at,
            "last_used_at": Bookmark.last_used_at,
            "title": func.lower(func.coalesce(func.nullif(Bookmark.title, ''), Bookmark.url)),
            "archived_at": Bookmark.archived_at,
            "deleted_at": Bookmark.deleted_at,
        }

    async def _check_url_exists(
        self,
        db: AsyncSession,
        user_id: UUID,
        url: str,
    ) -> Bookmark | None:
        """Check if a URL exists for this user (excluding soft-deleted)."""
        result = await db.execute(
            select(Bookmark).where(
                Bookmark.user_id == user_id,
                Bookmark.url == url,
                Bookmark.deleted_at.is_(None),
            ),
        )
        return result.scalar_one_or_none()

    def _validate_field_limits(
        self,
        limits: TierLimits,
        url: str | None = None,
        title: str | None = None,
        description: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> None:
        """
        Validate field lengths against tier limits.

        Args:
            limits: User's tier limits.
            url: URL to validate.
            title: Title to validate.
            description: Description to validate.
            content: Content to validate.
            tags: Tags to validate (each tag name is checked).

        Raises:
            FieldLimitExceededError: If any field exceeds its limit.
        """
        if url is not None and len(url) > limits.max_url_length:
            raise FieldLimitExceededError("url", len(url), limits.max_url_length)
        if title is not None and len(title) > limits.max_title_length:
            raise FieldLimitExceededError("title", len(title), limits.max_title_length)
        if description is not None and len(description) > limits.max_description_length:
            raise FieldLimitExceededError(
                "description", len(description), limits.max_description_length,
            )
        if content is not None and len(content) > limits.max_bookmark_content_length:
            raise FieldLimitExceededError(
                "content", len(content), limits.max_bookmark_content_length,
            )
        if tags is not None:
            for tag in tags:
                if len(tag) > limits.max_tag_name_length:
                    raise FieldLimitExceededError(
                        "tag", len(tag), limits.max_tag_name_length,
                    )

    async def check_quota(
        self,
        db: AsyncSession,
        user_id: UUID,
        limits: TierLimits,
    ) -> None:
        """
        Check if user has quota to create a new bookmark.

        Args:
            db: Database session.
            user_id: User ID to check quota for.
            limits: User's tier limits.

        Raises:
            QuotaExceededError: If user is at or over their bookmark limit.
        """
        current = await self.count_user_items(db, user_id)
        if current >= limits.max_bookmarks:
            raise QuotaExceededError("bookmark", current, limits.max_bookmarks)

    async def create(
        self,
        db: AsyncSession,
        user_id: UUID,
        data: BookmarkCreate,
        limits: TierLimits,
        context: RequestContext | None = None,
    ) -> Bookmark:
        """
        Create a new bookmark for a user.

        Args:
            db: Database session.
            user_id: User ID to create the bookmark for.
            data: Bookmark creation data.
            limits: User's tier limits for quota and field validation.
            context: Request context for history recording. If None, history is skipped.

        Returns:
            The created bookmark.

        Raises:
            QuotaExceededError: If user has reached their bookmark limit.
            FieldLimitExceededError: If any field exceeds tier limits.
            DuplicateUrlError: If URL exists as an active bookmark.
            ArchivedUrlExistsError: If URL exists as an archived bookmark.
        """
        url_str = str(data.url)

        # Check quota before creating
        await self.check_quota(db, user_id, limits)

        # Validate field lengths
        self._validate_field_limits(
            limits,
            url=url_str,
            title=data.title,
            description=data.description,
            content=data.content,
            tags=data.tags,
        )

        # Check if URL already exists for this user (non-deleted)
        existing = await self._check_url_exists(db, user_id, url_str)
        if existing:
            if existing.is_archived:
                raise ArchivedUrlExistsError(url_str, existing.id)
            raise DuplicateUrlError(url_str)

        # Get or create tags
        tag_objects = await get_or_create_tags(db, user_id, data.tags)
        bookmark = Bookmark(
            user_id=user_id,
            url=url_str,
            title=data.title,
            description=data.description,
            content=data.content,
            archived_at=data.archived_at,
        )
        bookmark.tag_objects = tag_objects
        db.add(bookmark)
        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            if "uq_bookmark_user_url_active" in str(e):
                raise DuplicateUrlError(url_str) from e
            raise
        await db.refresh(bookmark)
        await db.refresh(bookmark, attribute_names=["tag_objects"])
        # Set last_used_at to match created_at for "never clicked" detection
        bookmark.last_used_at = bookmark.created_at
        await db.flush()

        # Record history for CREATE action
        if context:
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=bookmark.id,
                action=ActionType.CREATE,
                current_content=bookmark.content,
                previous_content=None,
                metadata=self._get_metadata_snapshot(bookmark),
                context=context,
                limits=limits,
            )

        return bookmark

    async def update(
        self,
        db: AsyncSession,
        user_id: UUID,
        bookmark_id: UUID,
        data: BookmarkUpdate,
        limits: TierLimits,
        context: RequestContext | None = None,
        action: ActionType = ActionType.UPDATE,
    ) -> Bookmark | None:
        """
        Update a bookmark.

        Args:
            db: Database session.
            user_id: User ID to scope the bookmark.
            bookmark_id: ID of the bookmark to update.
            data: Update data.
            limits: User's tier limits for field validation.
            context: Request context for history recording. If None, history is skipped.
            action: Action type for history recording (UPDATE or RESTORE).

        Returns:
            The updated bookmark, or None if not found.

        Raises:
            FieldLimitExceededError: If any field exceeds tier limits.
            DuplicateUrlError: If the new URL already exists.
        """
        bookmark = await self.get(db, user_id, bookmark_id, include_archived=True)
        if bookmark is None:
            return None

        # Capture state before modification for diff and no-op detection
        previous_content = bookmark.content
        previous_metadata = self._get_metadata_snapshot(bookmark)

        update_data = data.model_dump(exclude_unset=True, exclude={"expected_updated_at"})

        # Convert HttpUrl to string if URL is being updated
        if "url" in update_data and update_data["url"] is not None:
            update_data["url"] = str(update_data["url"])

        # Handle tag updates separately
        new_tags = update_data.pop("tags", None)

        # Validate field lengths for fields being updated
        self._validate_field_limits(
            limits,
            url=update_data.get("url"),
            title=update_data.get("title"),
            description=update_data.get("description"),
            content=update_data.get("content"),
            tags=new_tags,
        )

        for field, value in update_data.items():
            setattr(bookmark, field, value)

        if new_tags is not None:
            await update_bookmark_tags(db, bookmark, new_tags)

        bookmark.updated_at = func.clock_timestamp()

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            if "uq_bookmark_user_url_active" in str(e):
                raise DuplicateUrlError(str(update_data.get("url", ""))) from e
            raise
        await self._refresh_with_tags(db, bookmark)

        # Only record history if something actually changed
        current_metadata = self._get_metadata_snapshot(bookmark)
        content_changed = bookmark.content != previous_content
        metadata_changed = current_metadata != previous_metadata

        if context and (content_changed or metadata_changed):
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=bookmark.id,
                action=action,
                current_content=bookmark.content,
                previous_content=previous_content,
                metadata=current_metadata,
                context=context,
                limits=limits,
            )

        return bookmark

    async def restore(
        self,
        db: AsyncSession,
        user_id: UUID,
        entity_id: UUID,
        context: RequestContext | None = None,
        limits: TierLimits | None = None,
    ) -> Bookmark | None:
        """
        Restore a soft-deleted bookmark.

        Overrides base to add URL uniqueness check.

        Note: No quota check is needed because soft-deleted items already
        count toward the user's quota. Restoring just changes state.

        Args:
            db: Database session.
            user_id: User ID to scope the bookmark.
            entity_id: ID of the bookmark to restore.
            context: Request context for history recording. If None, history is skipped.
            limits: User's tier limits for count-based pruning. If None, pruning is skipped.

        Returns:
            The restored bookmark, or None if not found.

        Raises:
            InvalidStateError: If the bookmark is not deleted.
            DuplicateUrlError: If an active bookmark with the same URL exists.
        """
        # Find the bookmark (must be deleted)
        result = await db.execute(
            select(Bookmark)
            .options(selectinload(Bookmark.tag_objects))
            .where(
                Bookmark.id == entity_id,
                Bookmark.user_id == user_id,
                Bookmark.deleted_at.is_not(None),
            ),
        )
        bookmark = result.scalar_one_or_none()

        if bookmark is None:
            non_deleted = await self.get(db, user_id, entity_id, include_archived=True)
            if non_deleted is not None:
                raise InvalidStateError("Bookmark is not deleted")
            return None

        # Check URL uniqueness before restore
        existing = await self._check_url_exists(db, user_id, bookmark.url)
        if existing and existing.id != entity_id:
            raise DuplicateUrlError(bookmark.url)

        # Record history BEFORE restoring (captures pre-restore state)
        # UNDELETE is an audit action - no content, no version
        if context:
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=entity_id,
                action=ActionType.UNDELETE,
                current_content=None,
                previous_content=None,
                metadata=self._get_audit_metadata(bookmark),
                context=context,
                limits=limits,
            )

        bookmark.deleted_at = None
        bookmark.archived_at = None
        await db.flush()
        await self._refresh_with_tags(db, bookmark)
        return bookmark

