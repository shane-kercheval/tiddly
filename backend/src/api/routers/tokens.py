"""API Token (PAT) management endpoints."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_limits_auth0_only,
    get_current_user_auth0_only,
)
from core.tier_limits import TierLimits
from models.user import User
from schemas.token import TokenCreate, TokenCreateResponse, TokenRenameRequest, TokenResponse
from services import token_service

router = APIRouter(prefix="/tokens", tags=["tokens"])


@router.post("/", response_model=TokenCreateResponse, status_code=201)
async def create_token(
    data: TokenCreate,
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits_auth0_only),
) -> TokenCreateResponse:
    """
    Create a new API token (PAT).

    **Authentication: Auth0 only (PATs not accepted - returns 403)**

    IMPORTANT: The plaintext token is only returned once. Store it securely.
    """
    api_token, plaintext = await token_service.create_token(db, current_user.id, data, limits)
    return TokenCreateResponse(
        id=api_token.id,
        name=api_token.name,
        token=plaintext,
        token_prefix=api_token.token_prefix,
        expires_at=api_token.expires_at,
        created_at=api_token.created_at,
    )


@router.get("/", response_model=list[TokenResponse])
async def list_tokens(
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
) -> list[TokenResponse]:
    """
    List all API tokens for the current user.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**

    Note: Plaintext tokens are never returned - only metadata.
    """
    tokens = await token_service.get_tokens(db, current_user.id)
    return [TokenResponse.model_validate(t) for t in tokens]


@router.patch("/{token_id}", response_model=TokenResponse)
async def rename_token(
    token_id: UUID,
    rename_request: TokenRenameRequest,
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
) -> TokenResponse:
    """
    Rename an API token.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**
    """
    token = await token_service.rename_token(
        db, current_user.id, token_id, rename_request.new_name,
    )
    if token is None:
        raise HTTPException(status_code=404, detail="Token not found")
    return TokenResponse.model_validate(token)


@router.delete("/{token_id}", status_code=204)
async def delete_token(
    token_id: UUID,
    current_user: User = Depends(get_current_user_auth0_only),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """
    Revoke (delete) an API token.

    **Authentication: Auth0 only (PATs not accepted - returns 403)**
    """
    deleted = await token_service.delete_token(db, current_user.id, token_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Token not found")
