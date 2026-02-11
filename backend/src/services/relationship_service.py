"""Service layer for content relationship CRUD operations."""
from uuid import UUID

from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.bookmark import Bookmark
from models.content_history import EntityType
from models.content_relationship import ContentRelationship
from models.note import Note
from models.prompt import Prompt
from services.exceptions import (
    ContentNotFoundError,
    DuplicateRelationshipError,
    InvalidRelationshipError,
)

# Map EntityType values to model classes for validation queries.
# Uses direct model imports (not services) to avoid circular dependencies,
# following the same pattern as HistoryService._get_entity().
MODEL_MAP: dict[str, type[Bookmark] | type[Note] | type[Prompt]] = {
    EntityType.BOOKMARK: Bookmark,
    EntityType.NOTE: Note,
    EntityType.PROMPT: Prompt,
}

# Valid content types, derived from EntityType (single source of truth).
VALID_CONTENT_TYPES = frozenset(EntityType)

# Valid relationship types. Add 'references', 'subtask', 'blocks' later.
VALID_RELATIONSHIP_TYPES = frozenset({"related"})

# Bidirectional relationship types where source/target are interchangeable.
# These types use canonical ordering to prevent duplicate A→B / B→A rows.
BIDIRECTIONAL_TYPES = frozenset({"related"})


async def validate_content_exists(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
) -> bool:
    """
    Check if content exists and belongs to user. Excludes soft-deleted content.

    Archived items are valid relationship targets (archived_at is independent
    of deleted_at, and archived content is still accessible).
    """
    model = MODEL_MAP.get(content_type)
    if model is None:
        return False
    stmt = select(
        exists().where(
            model.id == content_id,
            model.user_id == user_id,
            model.deleted_at.is_(None),
        ),
    )
    result = await db.scalar(stmt)
    return bool(result)


def canonical_pair(
    type_a: str,
    id_a: UUID,
    type_b: str,
    id_b: UUID,
) -> tuple[str, UUID, str, UUID]:
    """
    Normalize a pair to canonical order: (source_type, source_id, target_type, target_id).

    Compares (type, str(id)) lexicographically. Used for bidirectional types
    ('related') to ensure A→B and B→A produce the same stored row.
    """
    if (type_a, str(id_a)) <= (type_b, str(id_b)):
        return type_a, id_a, type_b, id_b
    return type_b, id_b, type_a, id_a


async def create_relationship(
    db: AsyncSession,
    user_id: UUID,
    source_type: str,
    source_id: UUID,
    target_type: str,
    target_id: UUID,
    relationship_type: str,
    description: str | None = None,
) -> ContentRelationship:
    """
    Create a new relationship. Validates both endpoints exist.

    For bidirectional types ('related'), normalizes source/target to canonical
    order before insert so the unique constraint prevents both A→B and B→A.

    Raises:
        InvalidRelationshipError: If content/relationship type is invalid or self-reference.
        ContentNotFoundError: If source or target does not exist.
        DuplicateRelationshipError: If relationship already exists.
    """
    # Validate input types
    if source_type not in VALID_CONTENT_TYPES:
        raise InvalidRelationshipError(f"Invalid source type: {source_type}")
    if target_type not in VALID_CONTENT_TYPES:
        raise InvalidRelationshipError(f"Invalid target type: {target_type}")
    if relationship_type not in VALID_RELATIONSHIP_TYPES:
        raise InvalidRelationshipError(f"Invalid relationship type: {relationship_type}")

    # Validate not self-referencing
    if source_type == target_type and source_id == target_id:
        raise InvalidRelationshipError("Cannot create a relationship to the same content")

    # Normalize for bidirectional types
    if relationship_type in BIDIRECTIONAL_TYPES:
        source_type, source_id, target_type, target_id = canonical_pair(
            source_type, source_id, target_type, target_id,
        )

    # Validate both endpoints exist
    if not await validate_content_exists(db, user_id, source_type, source_id):
        raise ContentNotFoundError(source_type, source_id)
    if not await validate_content_exists(db, user_id, target_type, target_id):
        raise ContentNotFoundError(target_type, target_id)

    rel = ContentRelationship(
        user_id=user_id,
        source_type=source_type,
        source_id=source_id,
        target_type=target_type,
        target_id=target_id,
        relationship_type=relationship_type,
        description=description,
    )
    db.add(rel)
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        if "uq_content_relationship" in str(e):
            raise DuplicateRelationshipError from e
        raise
    await db.refresh(rel)
    return rel


async def get_relationship(
    db: AsyncSession,
    user_id: UUID,
    relationship_id: UUID,
) -> ContentRelationship | None:
    """Get a single relationship by ID, scoped to user."""
    stmt = select(ContentRelationship).where(
        ContentRelationship.id == relationship_id,
        ContentRelationship.user_id == user_id,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def update_relationship(
    db: AsyncSession,
    user_id: UUID,
    relationship_id: UUID,
    *,
    description: str | None = ...,  # type: ignore[assignment]
) -> ContentRelationship | None:
    """
    Update relationship metadata (currently only description).

    Uses sentinel default (...) to distinguish "not provided" from "explicitly
    set to None", consistent with existing service update patterns.

    Returns None if relationship not found.
    """
    rel = await get_relationship(db, user_id, relationship_id)
    if rel is None:
        return None

    if description is not ...:
        rel.description = description
        rel.updated_at = func.clock_timestamp()

    await db.flush()
    await db.refresh(rel)
    return rel


async def delete_relationship(
    db: AsyncSession,
    user_id: UUID,
    relationship_id: UUID,
) -> bool:
    """Delete a single relationship. Returns True if deleted, False if not found."""
    rel = await get_relationship(db, user_id, relationship_id)
    if rel is None:
        return False
    await db.delete(rel)
    await db.flush()
    return True


async def get_relationships_for_content(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
    relationship_type: str | None = None,
) -> list[ContentRelationship]:
    """
    Get relationships for a content item.

    For bidirectional types ('related'): queries both directions (where item
    is source OR target), since canonical ordering means the item could be
    stored in either position.

    Results are ordered by created_at DESC, id DESC for deterministic pagination.
    """
    # Build condition for matching this content as source or target
    is_source = and_(
        ContentRelationship.source_type == content_type,
        ContentRelationship.source_id == content_id,
    )
    is_target = and_(
        ContentRelationship.target_type == content_type,
        ContentRelationship.target_id == content_id,
    )

    stmt = (
        select(ContentRelationship)
        .where(
            ContentRelationship.user_id == user_id,
            or_(is_source, is_target),
        )
        .order_by(
            ContentRelationship.created_at.desc(),
            ContentRelationship.id.desc(),
        )
    )

    if relationship_type is not None:
        stmt = stmt.where(ContentRelationship.relationship_type == relationship_type)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def delete_relationships_for_content(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
) -> int:
    """
    Delete all relationships where this content is source OR target.

    Called when content is permanently deleted (application-level cascade).
    Returns the count of deleted relationships.
    """
    is_source = and_(
        ContentRelationship.source_type == content_type,
        ContentRelationship.source_id == content_id,
    )
    is_target = and_(
        ContentRelationship.target_type == content_type,
        ContentRelationship.target_id == content_id,
    )

    stmt = (
        delete(ContentRelationship)
        .where(
            ContentRelationship.user_id == user_id,
            or_(is_source, is_target),
        )
    )
    result = await db.execute(stmt)
    return result.rowcount
