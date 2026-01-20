"""Prompts CRUD endpoints."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Response as FastAPIResponse
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import (
    get_async_session,
    get_current_user,
)
from core.http_cache import check_not_modified, format_http_date
from models.user import User
from schemas.content_search import ContentSearchMatch, ContentSearchResponse
from schemas.errors import (
    PromptStrReplaceRequest,
    StrReplaceMultipleMatchesError,
    StrReplaceNoMatchError,
    StrReplaceSuccess,
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
from services import content_filter_service
from services.content_edit_service import (
    MultipleMatchesError,
    NoMatchError,
    str_replace,
)
from services.content_lines import apply_partial_read
from services.content_search_service import search_in_content
from services.exceptions import InvalidStateError
from services.prompt_service import NameConflictError, PromptService, validate_template
from services.template_renderer import TemplateError, render_template

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
    filter_id: UUID | None = Query(default=None, description="Filter by content filter ID"),
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
    - **filter_id**: Filter by content filter (can be combined with tags for additional filtering)
    """
    # If filter_id provided, fetch the filter and use its filter expression
    filter_expression = None
    if filter_id is not None:
        content_filter = await content_filter_service.get_filter(db, current_user.id, filter_id)
        if content_filter is None:
            raise HTTPException(status_code=404, detail="Filter not found")
        filter_expression = content_filter.filter_expression

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
    return response_data


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
    return response_data


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


@router.patch("/{prompt_id}/str-replace", response_model=StrReplaceSuccess[PromptResponse])
async def str_replace_prompt(
    prompt_id: UUID,
    data: PromptStrReplaceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> StrReplaceSuccess[PromptResponse]:
    r"""
    Replace text in a prompt's content (Jinja2 template) using string matching.

    The `old_str` must match exactly one location in the content. If it matches
    zero or multiple locations, the operation fails with an appropriate error.

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
    # Fetch the prompt (include archived, exclude deleted)
    prompt = await prompt_service.get(db, current_user.id, prompt_id, include_archived=True)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    # Check if content exists
    if prompt.content is None:
        raise HTTPException(
            status_code=400,
            detail=StrReplaceNoMatchError(
                message="Prompt has no content to edit",
            ).model_dump(),
        )

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

    # Update the prompt with new content
    prompt.content = result.new_content

    # If arguments were provided, update them atomically
    if data.arguments is not None:
        prompt.arguments = [arg.model_dump() for arg in data.arguments]

    prompt.updated_at = func.clock_timestamp()
    await db.flush()
    await db.refresh(prompt)
    await db.refresh(prompt, attribute_names=["tag_objects"])

    return StrReplaceSuccess(
        match_type=result.match_type,
        line=result.line,
        data=PromptResponse.model_validate(prompt),
    )


@router.delete("/{prompt_id}", status_code=204)
async def delete_prompt(
    prompt_id: UUID,
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
    prompt_id: UUID,
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
    prompt_id: UUID,
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
    prompt_id: UUID,
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
