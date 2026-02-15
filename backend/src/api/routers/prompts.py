"""Prompts CRUD endpoints."""

import io
import tarfile
import time
import zipfile
from typing import TYPE_CHECKING, Literal
from uuid import UUID

if TYPE_CHECKING:
    from models.prompt import Prompt

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Response as FastAPIResponse
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_limits,
    get_current_user,
)
from api.helpers import (
    check_optimistic_lock,
    check_optimistic_lock_by_name,
    resolve_filter_and_sorting,
)
from core.auth import get_request_context
from core.http_cache import check_not_modified, format_http_date
from core.tier_limits import TierLimits
from models.user import User
from services.exceptions import FieldLimitExceededError
from schemas.content_search import ContentSearchMatch, ContentSearchResponse
from schemas.history import HistoryListResponse, HistoryResponse
from schemas.errors import (
    ContentEmptyError,
    MinimalEntityData,
    PromptStrReplaceRequest,
    StrReplaceMultipleMatchesError,
    StrReplaceNoMatchError,
    StrReplaceSuccess,
    StrReplaceSuccessMinimal,
)
from schemas.prompt import (
    PromptCreate,
    PromptListItem,
    PromptListResponse,
    PromptRenderRequest,
    PromptRenderResponse,
    PromptResponse,
    PromptUpdate,
)
from services.content_edit_service import (
    MultipleMatchesError,
    NoMatchError,
    str_replace,
)
from services.content_lines import apply_partial_read
from services.content_search_service import search_in_content
from services.exceptions import InvalidStateError
from services.relationship_service import embed_relationships
from services.history_service import history_service
from services.prompt_service import NameConflictError, PromptService, validate_template
from models.content_history import ActionType, EntityType
from core.request_context import RequestContext
from services.skill_converter import ClientType, prompt_to_skill_md
from services.template_renderer import TemplateError, render_template

router = APIRouter(prefix="/prompts", tags=["prompts"])

# Page size for internal pagination when fetching all prompts for export
# Exposed as constant for testability
EXPORT_PAGE_SIZE = 100

# Type alias for str-replace response union
StrReplaceResponse = StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal


async def _perform_str_replace(
    db: AsyncSession,
    prompt: "Prompt",  # Forward reference to avoid circular import
    data: PromptStrReplaceRequest,
    include_updated_entity: bool,
    limits: TierLimits,
    context: RequestContext,
) -> StrReplaceResponse:
    """
    Core str-replace logic shared by ID and name-based endpoints.

    Performs string replacement on prompt content, validates the result as a
    Jinja2 template, and updates the prompt. Optionally updates arguments
    atomically with content changes.

    Args:
        db: Database session.
        prompt: The prompt to edit (must have content).
        data: The str-replace request with old_str, new_str, and optional arguments.
        include_updated_entity: If True, return full entity; otherwise minimal data.
        limits: User's tier limits for field validation.
        context: Request context for history recording.

    Returns:
        StrReplaceSuccess with full entity or minimal data.

    Raises:
        HTTPException: On validation errors, no match, or multiple matches.
        FieldLimitExceededError: If new content exceeds tier limits.
    """
    # Check if content exists
    if prompt.content is None:
        raise HTTPException(
            status_code=400,
            detail=ContentEmptyError(
                message="Prompt has no content to edit",
            ).model_dump(),
        )

    # Capture previous content for history
    previous_content = prompt.content

    # Perform str_replace
    try:
        result = str_replace(prompt.content, data.old_str, data.new_str)
    except NoMatchError:
        raise HTTPException(
            status_code=400,
            detail=StrReplaceNoMatchError().model_dump(),
        )
    except MultipleMatchesError as e:
        raise HTTPException(
            status_code=400,
            detail=StrReplaceMultipleMatchesError(
                matches=[
                    ContentSearchMatch(field="content", line=line, context=ctx)
                    for line, ctx in e.matches
                ],
            ).model_dump(),
        )

    # Check for no-op (content unchanged AND no argument update requested)
    if result.new_content == previous_content and data.arguments is None:
        if include_updated_entity:
            await db.refresh(prompt, attribute_names=["tag_objects"])
            return StrReplaceSuccess(
                match_type=result.match_type,
                line=result.line,
                data=PromptResponse.model_validate(prompt),
            )
        return StrReplaceSuccessMinimal(
            match_type=result.match_type,
            line=result.line,
            data=MinimalEntityData(id=prompt.id, updated_at=prompt.updated_at),
        )

    # Determine which arguments to use for validation:
    # - If data.arguments is provided, use it (enables atomic content + args update)
    # - Otherwise, use the prompt's existing arguments
    if data.arguments is not None:
        # Convert PromptArgument models to dicts for validate_template
        validation_arguments = [arg.model_dump() for arg in data.arguments]
    else:
        validation_arguments = prompt.arguments or []

    # Validate the new content as a Jinja2 template BEFORE applying changes
    try:
        validate_template(result.new_content, validation_arguments)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Replacement would create invalid template: {e}",
        )

    # Validate new content length against tier limits
    if len(result.new_content) > limits.max_prompt_content_length:
        raise FieldLimitExceededError(
            "content", len(result.new_content), limits.max_prompt_content_length,
        )

    # Update the prompt with new content
    prompt.content = result.new_content

    # If arguments were provided, update them atomically
    if data.arguments is not None:
        prompt.arguments = [arg.model_dump() for arg in data.arguments]

    prompt.updated_at = func.clock_timestamp()
    await db.flush()
    await db.refresh(prompt)

    # Record history for str-replace (content changed)
    await db.refresh(prompt, attribute_names=["tag_objects"])
    metadata = await prompt_service.get_metadata_snapshot(db, prompt.user_id, prompt)
    await history_service.record_action(
        db=db,
        user_id=prompt.user_id,
        entity_type=EntityType.PROMPT,
        entity_id=prompt.id,
        action=ActionType.UPDATE,
        current_content=prompt.content,
        previous_content=previous_content,
        metadata=metadata,
        context=context,
        limits=limits,
    )

    if include_updated_entity:
        return StrReplaceSuccess(
            match_type=result.match_type,
            line=result.line,
            data=PromptResponse.model_validate(prompt),
        )

    return StrReplaceSuccessMinimal(
        match_type=result.match_type,
        line=result.line,
        data=MinimalEntityData(id=prompt.id, updated_at=prompt.updated_at),
    )

prompt_service = PromptService()


@router.post("/", response_model=PromptResponse, status_code=201)
async def create_prompt(
    request: Request,
    data: PromptCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """Create a new prompt."""
    context = get_request_context(request)
    try:
        prompt = await prompt_service.create(db, current_user.id, data, limits, context)
    except NameConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), "error_code": "NAME_CONFLICT"},
        )
    except ValueError as e:
        # Template validation errors
        raise HTTPException(status_code=400, detail=str(e))
    response_data = PromptResponse.model_validate(prompt)
    response_data.relationships = await embed_relationships(
        db, current_user.id, 'prompt', prompt.id,
    )
    return response_data


@router.get("/", response_model=PromptListResponse)
async def list_prompts(
    q: str | None = Query(
        default=None,
        description="Search query (matches name, title, description, content)",
    ),
    tags: list[str] = Query(default=[], description="Filter by tags"),
    tag_match: Literal["all", "any"] = Query(
        default="all",
        description="Tag matching mode: 'all' (AND) or 'any' (OR)",
    ),
    sort_by: Literal["created_at", "updated_at", "last_used_at", "title", "archived_at", "deleted_at"] | None = \
        Query(  # noqa: E501
            default=None,
            description="Sort field. Takes precedence over filter_id's default.",
        ),
    sort_order: Literal["asc", "desc"] | None = Query(
        default=None,
        description="Sort direction. Takes precedence over filter_id's default.",
    ),
    offset: int = Query(default=0, ge=0, description="Pagination offset"),
    limit: int = Query(default=50, ge=1, le=100, description="Pagination limit"),
    view: Literal["active", "archived", "deleted"] = Query(
        default="active",
        description="Which prompts to show: active (default), archived, or deleted",
    ),
    filter_id: UUID | None = Query(default=None, description="Filter by content filter ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptListResponse:
    """
    List prompts for the current user with search, filtering, and sorting.

    - **q**: Text search across name, title, description, and content (case-insensitive)
    - **tags**: Filter by one or more tags (normalized to lowercase)
    - **tag_match**: 'all' requires prompt to have ALL specified tags, 'any' requires ANY tag
    - **sort_by**: Sort field. Takes precedence over filter_id's default.
    - **sort_order**: Sort direction. Takes precedence over filter_id's default.
    - **view**: Which prompts to show - 'active' (not deleted/archived), 'archived', or 'deleted'
    - **filter_id**: Filter by content filter (can be combined with tags for additional filtering)
    """
    resolved = await resolve_filter_and_sorting(
        db, current_user.id, filter_id, sort_by, sort_order,
    )

    try:
        prompts, total = await prompt_service.search(
            db=db,
            user_id=current_user.id,
            query=q,
            tags=tags if tags else None,
            tag_match=tag_match,
            sort_by=resolved.sort_by,
            sort_order=resolved.sort_order,
            offset=offset,
            limit=limit,
            view=view,
            filter_expression=resolved.filter_expression,
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
    request: Request,
    response: FastAPIResponse,
    start_line: int | None = Query(
        default=None,
        ge=1,
        description="Start line for partial read (1-indexed). Defaults to 1 if end_line provided.",
    ),
    end_line: int | None = Query(
        default=None,
        ge=1,
        description="End line for partial read (1-indexed, inclusive). "
        "Defaults to total_lines if start_line provided.",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Get a prompt by name.

    Returns only active prompts (excludes deleted and archived).
    This endpoint is primarily used by the MCP server for prompt lookups.

    Supports partial reads via start_line and end_line parameters.
    When line params are provided, only the specified line range is returned
    in the content field, with content_metadata indicating the range and total lines.
    """
    # Quick check: can we return 304?
    updated_at = await prompt_service.get_updated_at_by_name(db, current_user.id, name)
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Full fetch
    prompt = await prompt_service.get_by_name(db, current_user.id, name)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    response_data = PromptResponse.model_validate(prompt)
    apply_partial_read(response_data, start_line, end_line)

    # Embed relationships
    response_data.relationships = await embed_relationships(
        db, current_user.id, 'prompt', prompt.id,
    )

    return response_data


@router.get("/name/{name}/metadata", response_model=PromptListItem)
async def get_prompt_metadata_by_name(
    name: str,
    request: Request,
    response: FastAPIResponse,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptListItem:
    """
    Get prompt metadata by name without loading full content.

    Returns content_length (character count) and content_preview (first 500 chars)
    for size assessment before fetching full content via GET /prompts/name/{name}.

    Returns only active prompts (excludes deleted and archived).
    This endpoint is primarily used by the MCP server for prompt metadata lookups.
    """
    if "start_line" in request.query_params or "end_line" in request.query_params:
        raise HTTPException(
            status_code=400,
            detail="start_line/end_line parameters are not valid on metadata endpoints. "
            "Use GET /prompts/name/{name} for partial content reads.",
        )
    # Quick check: can we return 304?
    updated_at = await prompt_service.get_updated_at_by_name(db, current_user.id, name)
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Fetch metadata only (no full content)
    prompt = await prompt_service.get_metadata_by_name(db, current_user.id, name)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    return PromptListItem.model_validate(prompt)


@router.patch("/name/{name}", response_model=PromptResponse)
async def update_prompt_by_name(
    name: str,
    request: Request,
    data: PromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """
    Update a prompt by name.

    Returns only active prompts (excludes deleted and archived).
    This endpoint is primarily used by the MCP server for prompt updates.
    To edit archived prompts, restore them first via the API or web UI.
    """
    context = get_request_context(request)
    # Check for conflicts before updating
    await check_optimistic_lock_by_name(
        db, prompt_service, current_user.id, name,
        data.expected_updated_at, PromptResponse,
    )

    # Look up by name (active prompts only)
    prompt = await prompt_service.get_by_name(db, current_user.id, name)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    try:
        updated_prompt = await prompt_service.update(
            db, current_user.id, prompt.id, data, limits, context,
        )
    except NameConflictError as e:
        raise HTTPException(
            status_code=409,
            detail={"message": str(e), "error_code": "NAME_CONFLICT"},
        )
    except ValueError as e:
        # Template validation errors
        raise HTTPException(status_code=400, detail=str(e))
    if updated_prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    response_data = PromptResponse.model_validate(updated_prompt)
    response_data.relationships = await embed_relationships(
        db, current_user.id, 'prompt', updated_prompt.id,
    )
    return response_data


@router.patch(
    "/name/{name}/str-replace",
    response_model=StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal,
)
async def str_replace_prompt_by_name(
    name: str,
    request: Request,
    data: PromptStrReplaceRequest,
    include_updated_entity: bool = Query(
        default=False,
        description="If true, include full updated entity in response. "
        "Default (false) returns only id and updated_at.",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal:
    r"""
    Replace text in a prompt's content by name using string matching.

    Same as PATCH /prompts/{id}/str-replace but looks up by name instead of ID.
    Returns only active prompts (excludes deleted and archived).
    This endpoint is primarily used by the MCP server for prompt edits.
    To edit archived prompts, restore them first via the API or web UI.

    Note: There is a tiny race window where a prompt could be archived between
    lookup and edit. This is accepted behavior given the extremely small window
    and minimal impact (edit succeeds on now-archived prompt).

    See PATCH /prompts/{id}/str-replace for full documentation on matching
    strategy, atomic content + arguments updates, and error responses.
    """
    context = get_request_context(request)
    # Check for conflicts before modifying
    await check_optimistic_lock_by_name(
        db, prompt_service, current_user.id, name,
        data.expected_updated_at, PromptResponse,
    )

    # Look up by name (active prompts only)
    prompt = await prompt_service.get_by_name(db, current_user.id, name)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    return await _perform_str_replace(db, prompt, data, include_updated_entity, limits, context)


def _build_skills_dict(
    prompts: list["Prompt"],
    client: ClientType,
) -> dict[str, str]:
    """
    Convert prompts to skills and deduplicate by directory name.

    If multiple prompts truncate to the same directory name, the last one wins.
    This ensures deterministic archive contents regardless of extraction tool.

    Returns:
        Dict mapping directory_name to SKILL.md content.
    """
    skills: dict[str, str] = {}
    for prompt in prompts:
        skill = prompt_to_skill_md(prompt, client)
        skills[skill.directory_name] = skill.content
    return skills


def _create_tar_gz(prompts: list["Prompt"], client: ClientType) -> io.BytesIO:
    """Create a tar.gz archive containing SKILL.md files for each prompt."""
    skills = _build_skills_dict(prompts, client)
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for directory_name, content in skills.items():
            content_bytes = content.encode("utf-8")
            info = tarfile.TarInfo(name=f"{directory_name}/SKILL.md")
            info.size = len(content_bytes)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(content_bytes))
    buffer.seek(0)
    return buffer


def _create_zip(prompts: list["Prompt"], client: ClientType) -> io.BytesIO:
    """Create a zip archive containing flat .md skill files for each prompt."""
    skills = _build_skills_dict(prompts, client)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for skill_name, content in skills.items():
            zf.writestr(f"{skill_name}.md", content)
    buffer.seek(0)
    return buffer


@router.get("/export/skills")
async def export_skills(
    client: ClientType = Query(..., description="Target client for export"),
    tags: list[str] = Query(
        default=[],
        description="Tags to filter prompts (empty = all prompts)",
    ),
    tag_match: Literal["all", "any"] = Query(
        default="all",
        description="Tag matching mode: 'all' (AND) or 'any' (OR)",
    ),
    view: Literal["active", "archived", "deleted"] = Query(
        default="active",
        description="View filter",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> StreamingResponse:
    """
    Export prompts as skills for the specified client.

    Returns an archive containing {prompt-name}/SKILL.md for each matching prompt.
    Archive format is determined by client:
    - claude-desktop: zip (for upload via Settings)
    - claude-code, codex: tar.gz (for direct extraction)

    If no tags specified, exports ALL prompts.

    The SKILL.md format follows the Agent Skills Standard (agentskills.io):
    - YAML frontmatter with name and description
    - Template Variables section documenting Jinja2 placeholders
    - Instructions section with the raw template content

    Client-specific constraints:
    - claude-code/claude-desktop: name max 64 chars, desc max 1024 chars
    - codex: name max 100 chars, desc max 500 chars (single-line only)
    """
    # Collect all matching prompts (handle pagination internally)
    all_prompts: list["Prompt"] = []  # noqa: UP037
    offset = 0

    while True:
        prompts, total = await prompt_service.search(
            db=db,
            user_id=current_user.id,
            tags=tags if tags else None,  # None = no tag filter
            tag_match=tag_match,
            view=view,
            offset=offset,
            limit=EXPORT_PAGE_SIZE,
            include_content=True,  # Need full content for export
        )
        all_prompts.extend(prompts)
        if len(all_prompts) >= total:
            break
        offset += EXPORT_PAGE_SIZE

    # Determine archive format based on client
    if client == "claude-desktop":
        archive = _create_zip(all_prompts, client)
        return StreamingResponse(
            archive,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=skills.zip"},
        )

    archive = _create_tar_gz(all_prompts, client)
    return StreamingResponse(
        archive,
        media_type="application/gzip",
        headers={"Content-Disposition": "attachment; filename=skills.tar.gz"},
    )


@router.get("/{prompt_id}", response_model=PromptResponse)
async def get_prompt(
    prompt_id: UUID,
    request: Request,
    response: FastAPIResponse,
    start_line: int | None = Query(
        default=None,
        ge=1,
        description="Start line for partial read (1-indexed). Defaults to 1 if end_line provided.",
    ),
    end_line: int | None = Query(
        default=None,
        ge=1,
        description="End line for partial read (1-indexed, inclusive). "
        "Defaults to total_lines if start_line provided.",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptResponse:
    """
    Get a single prompt by ID (includes archived and deleted prompts).

    Supports partial reads via start_line and end_line parameters.
    When line params are provided, only the specified line range is returned
    in the content field, with content_metadata indicating the range and total lines.
    """
    # Quick check: can we return 304?
    updated_at = await prompt_service.get_updated_at(
        db, current_user.id, prompt_id, include_deleted=True,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Full fetch
    prompt = await prompt_service.get(
        db, current_user.id, prompt_id, include_archived=True, include_deleted=True,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    response_data = PromptResponse.model_validate(prompt)
    apply_partial_read(response_data, start_line, end_line)

    # Embed relationships
    response_data.relationships = await embed_relationships(
        db, current_user.id, 'prompt', prompt_id,
    )

    return response_data


@router.get("/{prompt_id}/metadata", response_model=PromptListItem)
async def get_prompt_metadata(
    prompt_id: UUID,
    request: Request,
    response: FastAPIResponse,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptListItem:
    """
    Get prompt metadata without loading full content.

    Returns content_length (character count) and content_preview (first 500 chars)
    for size assessment before fetching full content via GET /prompts/{id}.

    This endpoint is useful for:
    - Checking content size before deciding to load full content
    - Getting quick context via the preview without full content transfer
    - Lightweight status checks
    """
    if "start_line" in request.query_params or "end_line" in request.query_params:
        raise HTTPException(
            status_code=400,
            detail="start_line/end_line parameters are not valid on metadata endpoints. "
            "Use GET /prompts/{id} for partial content reads.",
        )
    # Quick check: can we return 304?
    updated_at = await prompt_service.get_updated_at(
        db, current_user.id, prompt_id, include_deleted=True,
    )
    if updated_at is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    not_modified = check_not_modified(request, updated_at)
    if not_modified:
        return not_modified  # type: ignore[return-value]

    # Fetch metadata only (no full content)
    prompt = await prompt_service.get_metadata(
        db, current_user.id, prompt_id, include_archived=True, include_deleted=True,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Set Last-Modified header
    response.headers["Last-Modified"] = format_http_date(updated_at)

    return PromptListItem.model_validate(prompt)


@router.get("/{prompt_id}/search", response_model=ContentSearchResponse)
async def search_in_prompt(
    prompt_id: UUID,
    q: str = Query(min_length=1, description="Text to search for (literal match)"),
    fields: str = Query(
        default="content",
        description="Comma-separated fields to search: 'content', 'title', 'description'",
    ),
    case_sensitive: bool = Query(default=False, description="Case-sensitive search"),
    context_lines: int = Query(
        default=2,
        ge=0,
        le=10,
        description="Lines of context before/after match (content field only)",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentSearchResponse:
    """
    Search within a prompt's text fields to find matches with line numbers and context.

    This endpoint serves several purposes for AI agents:

    1. **Pre-edit validation** - Confirm how many matches exist before attempting
       str_replace (avoid "multiple matches" errors)
    2. **Context building** - Get surrounding lines to construct a unique `old_str`
       for editing
    3. **Content discovery** - Find where specific text appears in a document without
       reading the entire content into context
    4. **General search** - Non-editing use cases where agents need to locate
       information within content

    Returns:
        - `matches`: List of matches found. Empty array if no matches (success, not error).
        - `total_matches`: Count of matches found.

    For the `content` field (the Jinja2 template), matches include line numbers (1-indexed)
    and surrounding context lines. For `title` and `description` fields, the full field
    value is returned as context with `line: null`.
    """
    # Fetch the prompt
    prompt = await prompt_service.get(
        db, current_user.id, prompt_id, include_archived=True, include_deleted=True,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Parse and validate fields
    field_list = [f.strip().lower() for f in fields.split(",")]
    valid_fields = {"content", "title", "description"}
    invalid_fields = set(field_list) - valid_fields
    if invalid_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid fields: {', '.join(invalid_fields)}. "
            "Valid fields: content, title, description",
        )

    # Perform search
    matches = search_in_content(
        content=prompt.content,
        title=prompt.title,
        description=prompt.description,
        query=q,
        fields=field_list,
        case_sensitive=case_sensitive,
        context_lines=context_lines,
    )

    return ContentSearchResponse(
        matches=matches,
        total_matches=len(matches),
    )


@router.patch("/{prompt_id}", response_model=PromptResponse)
async def update_prompt(
    prompt_id: UUID,
    request: Request,
    data: PromptUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """Update a prompt."""
    context = get_request_context(request)
    # Check for conflicts before updating
    await check_optimistic_lock(
        db, prompt_service, current_user.id, prompt_id,
        data.expected_updated_at, PromptResponse,
    )

    try:
        prompt = await prompt_service.update(
            db, current_user.id, prompt_id, data, limits, context,
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
    response_data = PromptResponse.model_validate(prompt)
    response_data.relationships = await embed_relationships(
        db, current_user.id, 'prompt', prompt.id,
    )
    return response_data


@router.patch(
    "/{prompt_id}/str-replace",
    response_model=StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal,
)
async def str_replace_prompt(
    prompt_id: UUID,
    request: Request,
    data: PromptStrReplaceRequest,
    include_updated_entity: bool = Query(
        default=False,
        description="If true, include full updated entity in response. "
        "Default (false) returns only id and updated_at.",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal:
    r"""
    Replace text in a prompt's content (Jinja2 template) using string matching.

    The `old_str` must match exactly one location in the content. If it matches
    zero or multiple locations, the operation fails with an appropriate error.

    **Response format:**
    By default, returns minimal data (id and updated_at) to reduce bandwidth.
    Use `include_updated_entity=true` to get the full updated entity.

    **Important:** After replacement, the new content is validated as a Jinja2 template.
    If the replacement would create an invalid template (syntax error, undefined variables,
    unused arguments), the operation fails with a 400 error and no changes are made.

    **Atomic content + arguments updates:**

    The optional `arguments` field enables atomic updates when adding/removing template
    variables. This solves the chicken-and-egg problem where:
    - Adding a new variable to content fails ("undefined variable") if argument doesn't exist
    - Adding an argument fails ("unused argument") if variable doesn't exist in content

    When `arguments` is provided:
    - Validation uses the NEW arguments list (not the existing one)
    - Both content and arguments are updated atomically
    - The provided list FULLY REPLACES all existing arguments (not a merge)
    - To remove one argument while keeping others, include only the ones to keep

    When `arguments` is omitted:
    - Validation uses the prompt's existing arguments
    - Only content is updated

    **Matching strategy (progressive fallback):**
    1. **Exact match** - Character-for-character match
    2. **Whitespace normalized** - Normalizes line endings (\\r\\n → \\n) and strips
       trailing whitespace from each line before matching

    **Tips for successful edits:**
    - Include 3-5 lines of surrounding context in `old_str` to ensure uniqueness
    - Use the search endpoint (`GET /prompts/{id}/search`) first to check matches
    - For deletion, use empty string as `new_str`
    - When adding/removing template variables, provide the `arguments` field

    **Error responses:**
    - 400 with `error: "no_match"` if text not found
    - 400 with `error: "multiple_matches"` if text found in multiple locations
      (includes match locations with context to help construct unique match)
    - 400 with template validation error if result is invalid Jinja2
    """
    context = get_request_context(request)
    # Check for conflicts before modifying
    await check_optimistic_lock(
        db, prompt_service, current_user.id, prompt_id,
        data.expected_updated_at, PromptResponse,
    )

    # Fetch the prompt (include archived, exclude deleted)
    prompt = await prompt_service.get(db, current_user.id, prompt_id, include_archived=True)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    return await _perform_str_replace(db, prompt, data, include_updated_entity, limits, context)


@router.delete("/{prompt_id}", status_code=204)
async def delete_prompt(
    prompt_id: UUID,
    request: Request,
    permanent: bool = Query(default=False, description="Permanently delete from DB if true"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> None:
    """
    Delete a prompt.

    By default, performs a soft delete (sets deleted_at timestamp).
    Use ?permanent=true from the trash view to permanently remove from database.
    """
    context = get_request_context(request)
    deleted = await prompt_service.delete(
        db, current_user.id, prompt_id, permanent=permanent, context=context, limits=limits,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")


@router.post("/{prompt_id}/restore", response_model=PromptResponse)
async def restore_prompt(
    prompt_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """
    Restore a soft-deleted prompt to active state.

    Clears both deleted_at and archived_at timestamps, returning the prompt
    to active state (not archived).
    """
    context = get_request_context(request)
    try:
        prompt = await prompt_service.restore(
            db, current_user.id, prompt_id, context, limits=limits,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.post("/{prompt_id}/archive", response_model=PromptResponse)
async def archive_prompt(
    prompt_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """
    Archive a prompt.

    Sets archived_at timestamp. This operation is idempotent - archiving an
    already-archived prompt returns success with the current state.
    """
    context = get_request_context(request)
    prompt = await prompt_service.archive(
        db, current_user.id, prompt_id, context, limits=limits,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.post("/{prompt_id}/unarchive", response_model=PromptResponse)
async def unarchive_prompt(
    prompt_id: UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
    limits: TierLimits = Depends(get_current_limits),
) -> PromptResponse:
    """
    Unarchive a prompt.

    Clears archived_at timestamp, returning the prompt to active state.
    """
    context = get_request_context(request)
    try:
        prompt = await prompt_service.unarchive(
            db, current_user.id, prompt_id, context, limits=limits,
        )
    except InvalidStateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return PromptResponse.model_validate(prompt)


@router.post("/{prompt_id}/track-usage", status_code=204)
async def track_prompt_usage(
    prompt_id: UUID,
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


@router.post("/{prompt_id}/render", response_model=PromptRenderResponse)
async def render_prompt(
    prompt_id: UUID,
    request: PromptRenderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptRenderResponse:
    """
    Render a prompt template with provided arguments.

    Returns the template with Jinja2 variables replaced by argument values.
    Uses identical rendering logic as the MCP server.

    - Required arguments must be provided
    - Unknown arguments are rejected
    - Optional arguments default to empty string (enables {% if var %} conditionals)
    """
    # Fetch prompt (include archived/deleted so users can test any saved prompt)
    prompt = await prompt_service.get(
        db, current_user.id, prompt_id, include_archived=True, include_deleted=True,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    if not prompt.content:
        return PromptRenderResponse(rendered_content="")

    try:
        rendered = render_template(
            content=prompt.content,
            arguments=request.arguments,
            defined_args=prompt.arguments or [],
        )
    except TemplateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return PromptRenderResponse(rendered_content=rendered)


@router.get("/{prompt_id}/history", response_model=HistoryListResponse)
async def get_prompt_history(
    prompt_id: UUID,
    limit: int = Query(default=50, ge=1, le=100, description="Number of records to return"),
    offset: int = Query(default=0, ge=0, description="Number of records to skip"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> HistoryListResponse:
    """
    Get history for a specific prompt.

    Returns paginated history records for this prompt,
    sorted by version descending (most recent first).

    Returns empty list (not 404) if:
    - Prompt was hard-deleted (history cascade-deleted)
    - No history exists for this prompt_id
    """
    items, total = await history_service.get_entity_history(
        db, current_user.id, EntityType.PROMPT, prompt_id, limit, offset,
    )
    return HistoryListResponse(
        items=[HistoryResponse.model_validate(item) for item in items],
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(items) < total,
    )
