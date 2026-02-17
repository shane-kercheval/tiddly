"""Service layer for note CRUD operations."""
import logging
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from core.request_context import RequestContext
from core.tier_limits import TierLimits
from models.content_history import ActionType, EntityType
from models.note import Note
from models.tag import note_tags
from schemas.note import NoteCreate, NoteUpdate
from services import relationship_service
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

    @property
    def entity_type(self) -> EntityType:
        """Return the EntityType for notes."""
        return EntityType.NOTE

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
        context: RequestContext | None = None,
    ) -> Note:
        """
        Create a new note for a user.

        Args:
            db: Database session.
            user_id: User ID to create the note for.
            data: Note creation data.
            limits: User's tier limits for quota and field validation.
            context: Request context for history recording. If None, history is skipped.

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

        # Sync relationships (entity must exist for validation)
        if data.relationships:
            await relationship_service.sync_relationships_for_entity(
                db, user_id, self.entity_type, note.id, data.relationships,
                max_per_entity=limits.max_relationships_per_entity if limits else None,
            )

        # Record history for CREATE action
        if context:
            metadata = await self.get_metadata_snapshot(db, user_id, note)
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=note.id,
                action=ActionType.CREATE,
                current_content=note.content,
                previous_content=None,
                metadata=metadata,
                context=context,
                limits=limits,
                changed_fields=self._compute_changed_fields(
                    None, metadata, bool(note.content),
                ),
            )

        return note

    async def update(
        self,
        db: AsyncSession,
        user_id: UUID,
        note_id: UUID,
        data: NoteUpdate,
        limits: TierLimits,
        context: RequestContext | None = None,
        action: ActionType = ActionType.UPDATE,
    ) -> Note | None:
        """
        Update a note.

        Args:
            db: Database session.
            user_id: User ID to scope the note.
            note_id: ID of the note to update.
            data: Update data.
            limits: User's tier limits for field validation.
            context: Request context for history recording. If None, history is skipped.
            action: Action type for history recording (UPDATE or RESTORE).

        Returns:
            The updated note, or None if not found.

        Raises:
            FieldLimitExceededError: If any field exceeds tier limits.
        """
        note = await self.get(db, user_id, note_id, include_archived=True)
        if note is None:
            return None

        # Capture state before modification for diff and no-op detection
        previous_content = note.content
        previous_metadata = await self.get_metadata_snapshot(db, user_id, note)

        update_data = data.model_dump(exclude_unset=True, exclude={"expected_updated_at"})
        new_tags = update_data.pop("tags", None)

        # Handle relationship updates separately (None = no change, [] = clear all)
        new_relationships = update_data.pop("relationships", None)

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

        # Sync relationships if provided.
        # Guard uses new_relationships (popped from model_dump(exclude_unset=True)) to
        # distinguish "not provided" from "set to []". Value uses data.relationships for
        # typed RelationshipInput objects (both are always in sync).
        if new_relationships is not None:
            await relationship_service.sync_relationships_for_entity(
                db, user_id, self.entity_type, note.id, data.relationships,
                skip_missing_targets=(action == ActionType.RESTORE),
                max_per_entity=limits.max_relationships_per_entity if limits else None,
            )

        note.updated_at = func.clock_timestamp()

        await db.flush()
        await self._refresh_with_tags(db, note)

        # Only record history if something actually changed.
        # Reuse the previous relationship snapshot when relationships weren't in the
        # payload — they're guaranteed unchanged, so skip the redundant DB queries.
        rels_override = previous_metadata["relationships"] if new_relationships is None else None
        current_metadata = await self.get_metadata_snapshot(
            db, user_id, note, relationships_override=rels_override,
        )
        content_changed = note.content != previous_content
        metadata_changed = current_metadata != previous_metadata

        if context and (content_changed or metadata_changed):
            await self._get_history_service().record_action(
                db=db,
                user_id=user_id,
                entity_type=self.entity_type,
                entity_id=note.id,
                action=action,
                current_content=note.content,
                previous_content=previous_content,
                metadata=current_metadata,
                context=context,
                limits=limits,
                changed_fields=self._compute_changed_fields(
                    previous_metadata, current_metadata, content_changed,
                ),
            )

        return note

