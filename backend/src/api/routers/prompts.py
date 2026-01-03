"""Prompts CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_async_session, get_current_user
from models.user import User
from schemas.prompt import (
    PromptCreate,
    PromptListResponse,
    PromptResponse,
    PromptUpdate,
)
from services.prompt_service import prompt_service

router = APIRouter(prefix="/prompts", tags=["prompts"])


@router.post("/", response_model=PromptResponse, status_code=201)
async def create_prompt(
    data: PromptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Create a new prompt.

    - **name**: Prompt identifier (required, lowercase with hyphens)
    - **title**: Optional display title
    - **description**: Optional description
    - **content**: Jinja2 template content
    - **arguments**: List of prompt arguments
    """
    try:
        prompt = await prompt_service.create(db, current_user.id, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return PromptResponse.model_validate(prompt)


@router.get("/", response_model=PromptListResponse)
async def list_prompts(
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=50, ge=1, le=100, description="Pagination limit"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptListResponse:
    """List all prompts for the current user."""
    prompts, total = await prompt_service.list(
        db, current_user.id, offset=offset, limit=limit,
    )
    return PromptListResponse(
        items=[PromptResponse.model_validate(p) for p in prompts],
        total=total,
    )


@router.get("/{name}", response_model=PromptResponse)
async def get_prompt(
    name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """Get a prompt by name."""
    prompt = await prompt_service.get_by_name(db, current_user.id, name)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.patch("/{name}", response_model=PromptResponse)
async def update_prompt(
    name: str,
    data: PromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """Update a prompt."""
    try:
        prompt = await prompt_service.update(db, current_user.id, name, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.delete("/{name}", status_code=204)
async def delete_prompt(
    name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """Delete a prompt."""
    deleted = await prompt_service.delete(db, current_user.id, name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
