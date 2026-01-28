"""Router for MCP context endpoints."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import async_sessionmaker

from api.dependencies import get_current_user
from db.session import get_session_factory
from models.user import User
from schemas.mcp_context import ContentContextResponse, PromptContextResponse
from services.mcp_context_service import get_content_context, get_prompt_context

router = APIRouter(prefix="/mcp", tags=["MCP"])


def get_concurrent_queries() -> bool:
    """Whether to run context queries concurrently. Overridden in tests."""
    return True


@router.get("/context/content", response_model=ContentContextResponse)
async def content_context(
    tag_limit: int = Query(default=50, ge=1, le=100),
    recent_limit: int = Query(default=10, ge=1, le=50),
    filter_limit: int = Query(default=5, ge=0, le=20),
    filter_item_limit: int = Query(default=5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    session_factory: async_sessionmaker = Depends(get_session_factory),
    concurrent: bool = Depends(get_concurrent_queries),
) -> ContentContextResponse:
    """Get aggregated context about bookmarks and notes for AI agents."""
    return await get_content_context(
        session_factory=session_factory,
        user_id=current_user.id,
        tag_limit=tag_limit,
        recent_limit=recent_limit,
        filter_limit=filter_limit,
        filter_item_limit=filter_item_limit,
        concurrent=concurrent,
    )


@router.get("/context/prompts", response_model=PromptContextResponse)
async def prompt_context(
    tag_limit: int = Query(default=50, ge=1, le=100),
    recent_limit: int = Query(default=10, ge=1, le=50),
    filter_limit: int = Query(default=5, ge=0, le=20),
    filter_item_limit: int = Query(default=5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    session_factory: async_sessionmaker = Depends(get_session_factory),
    concurrent: bool = Depends(get_concurrent_queries),
) -> PromptContextResponse:
    """Get aggregated context about prompts for AI agents."""
    return await get_prompt_context(
        session_factory=session_factory,
        user_id=current_user.id,
        tag_limit=tag_limit,
        recent_limit=recent_limit,
        filter_limit=filter_limit,
        filter_item_limit=filter_item_limit,
        concurrent=concurrent,
    )
