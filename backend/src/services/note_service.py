"""Service layer for note CRUD operations."""
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from core.tier_limits import TierLimits
from models.note import Note
from models.tag import note_tags
from schemas.note import NoteCreate, NoteUpdate
from services.base_entity_service import BaseEntityService
from services.exceptions import FieldLimitExceededError, QuotaExceededError
from services.tag_service import get_or_create_tags, update_note_tags

logger = logging.getLogger(__name__)


class NoteService(BaseEntityService[Note]):
    """
    Note service with full CRUD operations.

    Extends BaseEntityService with note-specific:
    - Text search fields (title, description, content)
    - Sort columns (notes always have title, no fallback needed)
    """

    model = Note
    junction_table = note_tags
    entity_name = "Note"

    def _build_text_search_filter(self, pattern: str) -> list:
        """Build text search filter for note fields."""
        return [
            or_(
                Note.title.ilike(pattern),
                Note.description.ilike(pattern),
                Note.content.ilike(pattern),
            ),
        ]

    def _get_sort_columns(self) -> dict[str, ColumnElement[Any]]:
        """Get sort columns for notes."""
        return {
            "created_at": Note.created_at,
            "updated_at": Note.updated_at,
            "last_used_at": Note.last_used_at,
            "title": func.lower(Note.title),
            "archived_at": Note.archived_at,
            "deleted_at": Note.deleted_at,
        }

    def _validate_field_limits(
        self,
        limits: TierLimits,
        title: str | None = None,
        description: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> None:
        """
        Validate field lengths against tier limits.

        Args:
            limits: User's tier limits.
            title: Title to validate.
            description: Description to validate.
            content: Content to validate.
            tags: Tags to validate (each tag name is checked).

        Raises:
            FieldLimitExceededError: If any field exceeds its limit.
        """
        if title is not None and len(title) > limits.max_title_length:
            raise FieldLimitExceededError("title", len(title), limits.max_title_length)
        if description is not None and len(description) > limits.max_description_length:
            raise FieldLimitExceededError(
                "description", len(description), limits.max_description_length,
            )
        if content is not None and len(content) > limits.max_note_content_length:
            raise FieldLimitExceededError(
                "content", len(content), limits.max_note_content_length,
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
        Check if user has quota to create a new note.

        Args:
            db: Database session.
            user_id: User ID to check quota for.
            limits: User's tier limits.

        Raises:
            QuotaExceededError: If user is at or over their note limit.
        """
        current = await self.count_user_items(db, user_id)
        if current >= limits.max_notes:
            raise QuotaExceededError("note", current, limits.max_notes)

    async def create(
        self,
        db: AsyncSession,
        user_id: UUID,
        data: NoteCreate,
        limits: TierLimits,
    ) -> Note:
        """
        Create a new note for a user.

        Args:
            db: Database session.
            user_id: User ID to create the note for.
            data: Note creation data.
            limits: User's tier limits for quota and field validation.

        Returns:
            The created note.

        Raises:
            QuotaExceededError: If user has reached their note limit.
            FieldLimitExceededError: If any field exceeds tier limits.
        """
        # Check quota before creating
        await self.check_quota(db, user_id, limits)

        # Validate field lengths
        self._validate_field_limits(
            limits,
            title=data.title,
            description=data.description,
            content=data.content,
            tags=data.tags,
        )

        tag_objects = await get_or_create_tags(db, user_id, data.tags)
        note = Note(
            user_id=user_id,
            title=data.title,
            description=data.description,
            content=data.content,
            archived_at=data.archived_at,
        )
        note.tag_objects = tag_objects
        db.add(note)
        await db.flush()
        await db.refresh(note)
        await db.refresh(note, attribute_names=["tag_objects"])
        # Set last_used_at to match created_at for "never viewed" detection
        note.last_used_at = note.created_at
        await db.flush()
        return note

    async def update(
        self,
        db: AsyncSession,
        user_id: UUID,
        note_id: UUID,
        data: NoteUpdate,
        limits: TierLimits,
    ) -> Note | None:
        """
        Update a note.

        Args:
            db: Database session.
            user_id: User ID to scope the note.
            note_id: ID of the note to update.
            data: Update data.
            limits: User's tier limits for field validation.

        Returns:
            The updated note, or None if not found.

        Raises:
            FieldLimitExceededError: If any field exceeds tier limits.
        """
        note = await self.get(db, user_id, note_id, include_archived=True)
        if note is None:
            return None

        update_data = data.model_dump(exclude_unset=True, exclude={"expected_updated_at"})
        new_tags = update_data.pop("tags", None)

        # Validate field lengths for fields being updated
        self._validate_field_limits(
            limits,
            title=update_data.get("title"),
            description=update_data.get("description"),
            content=update_data.get("content"),
            tags=new_tags,
        )

        for field, value in update_data.items():
            setattr(note, field, value)

        if new_tags is not None:
            await update_note_tags(db, note, new_tags)

        note.updated_at = func.clock_timestamp()

        await db.flush()
        await self._refresh_with_tags(db, note)
        return note

