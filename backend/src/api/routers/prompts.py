"""Prompts CRUD endpoints."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_user,
)
from models.user import User
from schemas.prompt import (
    PromptCreate,
    PromptListItem,
    PromptListResponse,
    PromptResponse,
    PromptUpdate,
)
from services import content_list_service
from services.exceptions import InvalidStateError
from services.prompt_service import NameConflictError, PromptService

router = APIRouter(prefix="/prompts", tags=["prompts"])

prompt_service = PromptService()


@router.post("/", response_model=PromptResponse, status_code=201)
async def create_prompt(
    data: PromptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """Create a new prompt."""
    try:
        prompt = await prompt_service.create(db, current_user.id, data)
    except NameConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), "error_code": "NAME_CONFLICT"},
        )
    except ValueError as e:
        # Template validation errors
        raise HTTPException(status_code=400, detail=str(e))
    return PromptResponse.model_validate(prompt)


@router.get("/", response_model=PromptListResponse)
async def list_prompts(
    q: str | None = Query(default=None, description="Search query (matches name, title, description, content)"),  # noqa: E501
    tags: list[str] = Query(default=[], description="Filter by tags"),
    tag_match: Literal["all", "any"] = Query(default="all", description="Tag matching mode: 'all' (AND) or 'any' (OR)"),  # noqa: E501
    sort_by: Literal["created_at", "updated_at", "last_used_at", "title", "archived_at", "deleted_at"] = Query(default="created_at", description="Sort field"),  # noqa: E501
    sort_order: Literal["asc", "desc"] = Query(default="desc", description="Sort order"),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=50, ge=1, le=100, description="Pagination limit"),
    view: Literal["active", "archived", "deleted"] = Query(default="active", description="Which prompts to show: active (default), archived, or deleted"),  # noqa: E501
    list_id: int | None = Query(default=None, description="Filter by content list ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptListResponse:
    """
    List prompts for the current user with search, filtering, and sorting.

    - **q**: Text search across name, title, description, and content (case-insensitive)
    - **tags**: Filter by one or more tags (normalized to lowercase)
    - **tag_match**: 'all' requires prompt to have ALL specified tags, 'any' requires ANY tag
    - **sort_by**: Sort by created_at (default), updated_at, last_used_at, title, etc.
    - **sort_order**: Sort ascending or descending (default: desc)
    - **view**: Which prompts to show - 'active' (not deleted/archived), 'archived', or 'deleted'
    - **list_id**: Filter by content list (can be combined with tags for additional filtering)
    """
    # If list_id provided, fetch the list and use its filter expression
    filter_expression = None
    if list_id is not None:
        content_list = await content_list_service.get_list(db, current_user.id, list_id)
        if content_list is None:
            raise HTTPException(status_code=404, detail="List not found")
        filter_expression = content_list.filter_expression

    try:
        prompts, total = await prompt_service.search(
            db=db,
            user_id=current_user.id,
            query=q,
            tags=tags if tags else None,
            tag_match=tag_match,
            sort_by=sort_by,
            sort_order=sort_order,
            offset=offset,
            limit=limit,
            view=view,
            filter_expression=filter_expression,
        )
    except ValueError as e:
        # Tag validation errors from validate_and_normalize_tags
        raise HTTPException(status_code=400, detail=str(e))
    items = [PromptListItem.model_validate(p) for p in prompts]
    has_more = offset + len(items) < total
    return PromptListResponse(
        items=items,
        total=total,
        offset=offset,
        limit=limit,
        has_more=has_more,
    )


@router.get("/name/{name}", response_model=PromptResponse)
async def get_prompt_by_name(
    name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Get a prompt by name.

    Returns only active prompts (excludes deleted and archived).
    This endpoint is primarily used by the MCP server for prompt lookups.
    """
    prompt = await prompt_service.get_by_name(db, current_user.id, name)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.get("/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """Get a single prompt by ID (includes archived prompts)."""
    prompt = await prompt_service.get(
        db, current_user.id, prompt_id, include_archived=True,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.patch("/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: int,
    data: PromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """Update a prompt."""
    try:
        prompt = await prompt_service.update(
            db, current_user.id, prompt_id, data,
        )
    except NameConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), "error_code": "NAME_CONFLICT"},
        )
    except ValueError as e:
        # Template validation errors
        raise HTTPException(status_code=400, detail=str(e))
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.delete("/{prompt_id}", status_code=204)
async def delete_prompt(
    prompt_id: int,
    permanent: bool = Query(default=False, description="Permanently delete from DB if true"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Delete a prompt.

    By default, performs a soft delete (sets deleted_at timestamp).
    Use ?permanent=true from the trash view to permanently remove from database.
    """
    deleted = await prompt_service.delete(
        db, current_user.id, prompt_id, permanent=permanent,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")


@router.post("/{prompt_id}/restore", response_model=PromptResponse)
async def restore_prompt(
    prompt_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Restore a soft-deleted prompt to active state.

    Clears both deleted_at and archived_at timestamps, returning the prompt
    to active state (not archived).
    """
    try:
        prompt = await prompt_service.restore(
            db, current_user.id, prompt_id,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.post("/{prompt_id}/archive", response_model=PromptResponse)
async def archive_prompt(
    prompt_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Archive a prompt.

    Sets archived_at timestamp. This operation is idempotent - archiving an
    already-archived prompt returns success with the current state.
    """
    prompt = await prompt_service.archive(
        db, current_user.id, prompt_id,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.post("/{prompt_id}/unarchive", response_model=PromptResponse)
async def unarchive_prompt(
    prompt_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Unarchive a prompt.

    Clears archived_at timestamp, returning the prompt to active state.
    """
    try:
        prompt = await prompt_service.unarchive(
            db, current_user.id, prompt_id,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.post("/{prompt_id}/track-usage", status_code=204)
async def track_prompt_usage(
    prompt_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Track prompt usage by updating last_used_at timestamp.

    This is a fire-and-forget endpoint for the MCP server to call when a prompt
    is used. Works on active, archived, and deleted prompts.
    """
    updated = await prompt_service.track_usage(
        db, current_user.id, prompt_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Prompt not found")
