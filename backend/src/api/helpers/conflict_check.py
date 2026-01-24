"""Optimistic locking helpers for conflict detection on updates."""
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from services.base_entity_service import BaseEntityService
from services.prompt_service import PromptService


async def check_optimistic_lock(
    db: AsyncSession,
    service: BaseEntityService[Any],
    user_id: UUID,
    entity_id: UUID,
    expected_updated_at: datetime | None,
    response_schema: type[BaseModel],
) -> None:
    """
    Check for conflicts before update. Raises HTTPException 409 if stale.

    Call this at the start of update endpoints when expected_updated_at is provided.
    If expected_updated_at is None, this is a no-op (backwards compatible).

    Args:
        db: Database session.
        service: Entity service with get_updated_at() method.
        user_id: User ID to scope the entity.
        entity_id: ID of the entity to check.
        expected_updated_at: Client's expected updated_at timestamp. If None, skip check.
        response_schema: Pydantic schema to serialize the current entity state.

    Raises:
        HTTPException: 404 if entity not found, 409 if entity was modified.
    """
    if expected_updated_at is None:
        return  # No optimistic locking requested

    current_updated_at = await service.get_updated_at(db, user_id, entity_id)
    if current_updated_at is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    if current_updated_at > expected_updated_at:
        # Entity was modified since client loaded it
        current_entity = await service.get(db, user_id, entity_id, include_archived=True)
        if current_entity is None:
            # Race condition: entity was deleted between timestamp check and fetch
            raise HTTPException(status_code=404, detail="Entity not found")
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "This item was modified since you loaded it",
                "server_state": response_schema.model_validate(current_entity).model_dump(
                    mode="json",
                ),
            },
        )


async def check_optimistic_lock_by_name(
    db: AsyncSession,
    service: PromptService,
    user_id: UUID,
    name: str,
    expected_updated_at: datetime | None,
    response_schema: type[BaseModel],
) -> None:
    """
    Check for conflicts before update (by name). Raises HTTPException 409 if stale.

    Prompt-specific variant for by-name endpoints used by MCP server.

    Args:
        db: Database session.
        service: PromptService with get_updated_at_by_name() method.
        user_id: User ID to scope the entity.
        name: Name of the prompt to check.
        expected_updated_at: Client's expected updated_at timestamp. If None, skip check.
        response_schema: Pydantic schema to serialize the current entity state.

    Raises:
        HTTPException: 404 if entity not found, 409 if entity was modified.
    """
    if expected_updated_at is None:
        return  # No optimistic locking requested

    current_updated_at = await service.get_updated_at_by_name(db, user_id, name)
    if current_updated_at is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    if current_updated_at > expected_updated_at:
        # Entity was modified since client loaded it
        # Note: get_by_name returns active prompts only (by design for MCP use)
        current_entity = await service.get_by_name(db, user_id, name)
        if current_entity is None:
            # Race condition: prompt was deleted/archived between timestamp check and fetch
            raise HTTPException(status_code=404, detail="Prompt not found")
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "This item was modified since you loaded it",
                "server_state": response_schema.model_validate(current_entity).model_dump(
                    mode="json",
                ),
            },
        )
