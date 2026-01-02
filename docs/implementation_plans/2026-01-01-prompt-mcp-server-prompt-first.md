# Prompt MCP Server - Prompt-First Implementation

**Date:** 2026-01-01
**Status:** Draft
**Goal:** Create prompts as first-class entities with their own table, not derived from notes.

---

## References

### MCP Specification

- **Prompts Capability:** https://modelcontextprotocol.io/docs/concepts/prompts
- **MCP SDK (Python):** https://github.com/modelcontextprotocol/python-sdk

Key concepts from spec:
- `prompts/list` - Returns list of available prompts with name, description, arguments
- `prompts/get` - Returns rendered prompt content with provided arguments

**MCP SDK Types (from `mcp.types`):**

```python
# What we use from the SDK:
class Prompt(BaseMetadata):
    name: str                              # Required - prompt identifier (we use slug)
    description: str | None = None         # Optional
    arguments: list[PromptArgument] | None = None

class PromptArgument(BaseModel):
    name: str                              # Required - argument identifier
    description: str | None = None         # Optional
    required: bool | None = None           # Optional (None treated as False)

class GetPromptResult(Result):
    description: str | None = None
    messages: list[PromptMessage]          # Required - the rendered prompt content

class PromptMessage(BaseModel):
    role: Literal["user", "assistant"]     # Required
    content: TextContent | ImageContent | EmbeddedResource
```

**Low-level Server decorators:**
```python
@server.list_prompts()
async def handle_list() -> list[types.Prompt]:
    ...

@server.get_prompt()
async def handle_get(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
    ...
```

**Error Codes (JSON-RPC standard):**
- `INVALID_PARAMS = -32602` - Invalid prompt name, missing required arguments
- `INTERNAL_ERROR = -32603` - Server errors

**Error handling:**
```python
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, INVALID_PARAMS

raise McpError(ErrorData(code=INVALID_PARAMS, message="Prompt not found"))
```

### Reference Implementation (This Codebase)

The existing Bookmarks MCP Server provides patterns to follow:

| Component | Path | Notes |
|-----------|------|-------|
| Server | `backend/src/mcp_server/server.py` | Uses FastMCP (decorator-based) for tools. Prompt server will use low-level SDK for dynamic prompts. |
| Auth | `backend/src/mcp_server/auth.py` | Bearer token extraction from headers. **Can reuse pattern.** |
| API Client | `backend/src/mcp_server/api_client.py` | `api_get()`, `api_post()` helpers. **Can reuse directly.** |
| Tests | `backend/tests/mcp_server/` | Test patterns for tools, auth, API client. |

**Key difference:** The existing server uses FastMCP which requires decorators at import time. For prompts, we need the low-level `mcp.server.lowlevel.Server` to dynamically load prompts from the database at runtime.

---

## Why Prompt-First?

The original "notes with tag" approach had too many workarounds:

| Problem | Notes-as-Prompts Workaround | Prompt-First Solution |
|---------|-----------------------------|-----------------------|
| Identifying prompts | Tag configuration + filtering | Dedicated `prompts` table |
| Duplicate slugs | Deduplication by `updated_at` | Unique constraint `(user_id, slug)` |
| Slug collisions | UI warning, "winner" logic | DB enforces uniqueness |
| Conditional validation | Only validate when has prompt tag | Always validate |
| User confusion | "Which notes are prompts?" | Clear separation |
| Prompt-specific fields | Nullable `prompt_arguments` on notes | Required fields on prompts |

**Result:** Simpler code, clearer UX, proper constraints.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Client (Claude Desktop)                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ PAT Authentication
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              Prompt MCP Server (prompts.tiddly.me/mcp)          │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │  prompts/list    │  │  prompts/get                         │ │
│  │  Call API to get │  │  1. Call API to get prompt           │ │
│  │  all prompts     │  │  2. Render Jinja2 template           │ │
│  └──────────────────┘  └──────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP API
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Main API (api.tiddly.me)                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  POST /prompts/        - Create prompt                   │   │
│  │  GET /prompts/         - List prompts                    │   │
│  │  GET /prompts/{name}   - Get prompt by name              │   │
│  │  PATCH /prompts/{name} - Update prompt                   │   │
│  │  DELETE /prompts/{name} - Delete prompt                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  prompts                                                 │    │
│  │  - id (PK)                                              │    │
│  │  - user_id (FK → users)                                 │    │
│  │  - name (unique per user, e.g., "code-review")          │    │
│  │  - title (optional, e.g., "Code Review Assistant")      │    │
│  │  - description (optional)                               │    │
│  │  - content (Jinja2 template)                            │    │
│  │  - arguments (JSONB): [{name, description, required}]   │    │
│  │  - created_at, updated_at                               │    │
│  │  UNIQUE(user_id, name)                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Prompts Are Independent Entities

Prompts have their own table, model, schemas, and CRUD endpoints. They don't share the notes infrastructure.

### 2. Name and Title (Aligned with MCP SDK)

- `name` - Required programmatic identifier (lowercase with hyphens, e.g., "code-review")
- `title` - Optional human-readable display name (e.g., "Code Review Assistant")
- Unique constraint `(user_id, name)` enforced by database
- Update by name: `PATCH /prompts/{name}`
- MCP clients display `title` if provided, otherwise fall back to `name`

### 3. No Tag Configuration

Since prompts are their own entity, there's no need to configure which tag identifies prompts. All prompts are served by the MCP server.

### 4. Template Validation at Save Time

- All template variables must have corresponding arguments
- Validation always happens (not conditional on tags)
- Duplicate argument names rejected

### 5. Prompt Fields → MCP Fields

| Prompt Field | MCP Field | Notes |
|--------------|-----------|-------|
| `slug` | `name` | MCP prompt identifier |
| `description` | `description` | Optional |
| `content` | Template | Jinja2 template |
| `arguments` | `arguments` | List of argument definitions |

---

## Milestone 1: Database Schema

### Goal
Create the `prompts` table with proper constraints.

### Success Criteria
- Migration creates `prompts` table
- Unique constraint on `(user_id, slug)`
- All tests pass

### Key Changes

#### 1.1 Prompt Model

**File:** `backend/src/models/prompt.py` (new)

```python
"""Prompt model for MCP prompt server."""
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from models.user import User


class Prompt(Base, TimestampMixin):
    """
    User-defined prompt for the MCP prompt server.

    Each prompt is a Jinja2 template with defined arguments.
    Prompts are served via the Prompt MCP Server.
    """

    __tablename__ = "prompts"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_prompts_user_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Name is the MCP prompt identifier and URL path
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Prompt identifier, unique per user (e.g., 'code-review')",
    )

    # Title is the optional human-readable display name
    title: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Optional display title (e.g., 'Code Review Assistant')",
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Optional description",
    )

    # Jinja2 template content
    content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Jinja2 template content",
    )

    # Prompt arguments as JSONB
    arguments: Mapped[list[dict]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
        comment="Prompt arguments: [{name: str, description: str?, required: bool}]",
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="prompts")
```

#### 1.2 Update User Model

**File:** `backend/src/models/user.py` (update)

```python
# Add relationship
prompts: Mapped[list["Prompt"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan",
)
```

#### 1.3 Create Migration

```bash
make migration message="create prompts table"
```

The migration should create:
- `prompts` table with all columns
- Unique constraint `uq_prompts_user_name`
- Foreign key to `users` with cascade delete
- Index on `user_id`

### Testing Strategy

**Model basics:**
- Test prompt creation with valid data
- Test prompt has correct timestamps (created_at, updated_at)

**Unique constraint:**
- Test unique constraint prevents duplicate names for same user
- Test different users can have same name
- Test IntegrityError raised on duplicate (user_id, name)

**Cascade delete:**
- Test cascade delete removes prompts when user is deleted

---

## Milestone 2: Prompt Schemas & Service

### Goal
Create Pydantic schemas and service layer for prompt CRUD.

### Prerequisites
- Add `jinja2>=3.1.0` to `backend/pyproject.toml`

### Success Criteria
- Schemas for create, update, response
- Service with CRUD operations
- Template validation on save
- All tests pass

### Key Changes

#### 2.1 Pydantic Schemas

**File:** `backend/src/schemas/prompt.py` (new)

```python
"""Pydantic schemas for prompts."""
from datetime import datetime
from typing import Self

from pydantic import BaseModel, Field, model_validator


class PromptArgument(BaseModel):
    """Single prompt argument definition."""

    name: str = Field(
        pattern=r"^[a-z][a-z0-9_]*$",
        max_length=100,
        description="Argument name (lowercase, underscores allowed)",
    )
    description: str | None = Field(
        default=None,
        description="Description of the argument",
    )
    required: bool | None = Field(
        default=None,
        description="Whether this argument is required (None treated as False)",
    )


class PromptCreate(BaseModel):
    """Request body for creating a prompt."""

    name: str = Field(
        min_length=1,
        max_length=255,
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Prompt identifier (lowercase with hyphens, e.g., 'code-review')",
    )
    title: str | None = Field(
        default=None,
        max_length=500,
        description="Optional display title (e.g., 'Code Review Assistant')",
    )
    description: str | None = Field(
        default=None,
        description="Optional description",
    )
    content: str | None = Field(
        default=None,
        description="Jinja2 template content",
    )
    arguments: list[PromptArgument] = Field(
        default_factory=list,
        description="List of prompt arguments",
    )

    @model_validator(mode="after")
    def validate_arguments(self) -> Self:
        """Validate argument names are unique."""
        if self.arguments:
            names = [arg.name for arg in self.arguments]
            if len(names) != len(set(names)):
                duplicates = [n for n in names if names.count(n) > 1]
                raise ValueError(
                    f"Duplicate argument names: {', '.join(set(duplicates))}"
                )
        return self


class PromptUpdate(BaseModel):
    """Request body for updating a prompt."""

    name: str | None = Field(
        default=None,
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        max_length=255,
        description="New name (renames the prompt)",
    )
    title: str | None = Field(
        default=None,
        max_length=500,
        description="Display title",
    )
    description: str | None = None
    content: str | None = None
    arguments: list[PromptArgument] | None = None

    @model_validator(mode="after")
    def validate_arguments(self) -> Self:
        """Validate argument names are unique."""
        if self.arguments:
            names = [arg.name for arg in self.arguments]
            if len(names) != len(set(names)):
                duplicates = [n for n in names if names.count(n) > 1]
                raise ValueError(
                    f"Duplicate argument names: {', '.join(set(duplicates))}"
                )
        return self


class PromptResponse(BaseModel):
    """Response for a prompt."""

    id: int
    name: str
    title: str | None
    description: str | None
    content: str | None
    arguments: list[PromptArgument]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PromptListResponse(BaseModel):
    """Response for listing prompts."""

    items: list[PromptResponse]
    total: int
```

#### 2.2 Prompt Service

**File:** `backend/src/services/prompt_service.py` (new)

```python
"""Service for prompt CRUD operations."""
from typing import Any

from jinja2 import Environment, meta, TemplateSyntaxError
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt
from schemas.prompt import PromptCreate, PromptUpdate


_jinja_env = Environment()


def get_template_variables(content: str) -> set[str]:
    """Extract variable names from Jinja2 template."""
    if not content:
        return set()
    try:
        ast = _jinja_env.parse(content)
        return meta.find_undeclared_variables(ast)
    except TemplateSyntaxError:
        return set()


def validate_template(content: str | None, arguments: list[dict[str, Any]]) -> None:
    """
    Validate template variables match defined arguments.

    Raises:
        ValueError: If template uses undefined variables.
    """
    if not content:
        return

    template_vars = get_template_variables(content)
    if not template_vars:
        return

    defined_args = {arg["name"] for arg in arguments} if arguments else set()
    undefined = template_vars - defined_args

    if undefined:
        raise ValueError(
            f"Template uses undefined variable(s): {', '.join(sorted(undefined))}. "
            "Add them to arguments or remove from template."
        )


class PromptService:
    """Service for prompt CRUD operations."""

    async def create(
        self,
        db: AsyncSession,
        user_id: int,
        data: PromptCreate,
    ) -> Prompt:
        """
        Create a new prompt.

        Validates template variables match arguments.

        Raises:
            ValueError: If template validation fails or name already exists.
        """
        # Check name uniqueness
        existing = await self.get_by_name(db, user_id, data.name)
        if existing:
            raise ValueError(f"Prompt with name '{data.name}' already exists")

        # Validate template
        args_as_dicts = [arg.model_dump() for arg in data.arguments]
        validate_template(data.content, args_as_dicts)

        prompt = Prompt(
            user_id=user_id,
            name=data.name,
            title=data.title,
            description=data.description,
            content=data.content,
            arguments=args_as_dicts,
        )
        db.add(prompt)
        await db.flush()
        await db.refresh(prompt)
        return prompt

    async def get_by_name(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
    ) -> Prompt | None:
        """Get a prompt by name."""
        result = await db.execute(
            select(Prompt).where(
                Prompt.user_id == user_id,
                Prompt.name == name,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(
        self,
        db: AsyncSession,
        user_id: int,
        prompt_id: int,
    ) -> Prompt | None:
        """Get a prompt by ID."""
        result = await db.execute(
            select(Prompt).where(
                Prompt.user_id == user_id,
                Prompt.id == prompt_id,
            )
        )
        return result.scalar_one_or_none()

    async def list(
        self,
        db: AsyncSession,
        user_id: int,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[Prompt], int]:
        """List all prompts for a user."""
        # Get total count
        count_result = await db.execute(
            select(func.count(Prompt.id)).where(Prompt.user_id == user_id)
        )
        total = count_result.scalar() or 0

        # Get prompts
        result = await db.execute(
            select(Prompt)
            .where(Prompt.user_id == user_id)
            .order_by(Prompt.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        prompts = list(result.scalars().all())

        return prompts, total

    async def update(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
        data: PromptUpdate,
    ) -> Prompt | None:
        """
        Update a prompt.

        Raises:
            ValueError: If template validation fails or new name already exists.
        """
        prompt = await self.get_by_name(db, user_id, name)
        if not prompt:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # Check new name uniqueness if changing
        if "name" in update_data and update_data["name"] != name:
            existing = await self.get_by_name(db, user_id, update_data["name"])
            if existing:
                raise ValueError(
                    f"Prompt with name '{update_data['name']}' already exists"
                )

        # Validate template with effective values
        effective_content = update_data.get("content", prompt.content)
        effective_args = update_data.get("arguments", prompt.arguments)
        if effective_args and isinstance(effective_args[0], dict):
            args_as_dicts = effective_args
        else:
            args_as_dicts = [
                arg.model_dump() if hasattr(arg, "model_dump") else arg
                for arg in effective_args
            ]
        validate_template(effective_content, args_as_dicts)

        # Apply updates
        for field, value in update_data.items():
            if field == "arguments":
                setattr(prompt, field, args_as_dicts)
            else:
                setattr(prompt, field, value)

        await db.flush()
        await db.refresh(prompt)
        return prompt

    async def delete(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
    ) -> bool:
        """Delete a prompt. Returns True if deleted."""
        prompt = await self.get_by_name(db, user_id, name)
        if not prompt:
            return False

        await db.delete(prompt)
        await db.flush()
        return True


# Module-level instance
prompt_service = PromptService()
```

### Testing Strategy

**CRUD:**
- Test create prompt
- Test list returns all prompts ordered by updated_at
- Test update prompt
- Test update with name rename
- Test delete prompt

**Name validation:**
- Test create fails on duplicate name
- Test update fails on name collision
- Test invalid name format rejected (uppercase, spaces, special chars)
- Test empty name rejected
- Test name exceeding max length rejected

**Arguments validation:**
- Test duplicate argument names rejected
- Test invalid argument name format rejected (must start with letter, lowercase)
- Test argument name exceeding max length rejected

**Jinja template validation:**
- Test template with undefined variable rejected on create
- Test template with undefined variable rejected on update
- Test invalid Jinja syntax rejected (e.g., `{{ unclosed`)
- Test valid template with matching arguments passes

---

## Milestone 3: Prompt API Endpoints

### Goal
Create REST API endpoints for prompt CRUD.

### Success Criteria
- CRUD endpoints working
- Proper error responses
- All tests pass

### Key Changes

#### 3.1 Prompts Router

**File:** `backend/src/api/routers/prompts.py` (new)

```python
"""Prompts CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptListResponse:
    """List all prompts for the current user."""
    prompts, total = await prompt_service.list(
        db, current_user.id, offset=offset, limit=limit
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
```

#### 3.2 Register Router

**File:** `backend/src/api/main.py` (update)

```python
from api.routers import prompts
app.include_router(prompts.router)
```

### Testing Strategy

**CRUD endpoints:**
- Test POST creates prompt (201)
- Test GET list returns prompts
- Test GET by name returns prompt
- Test GET by name returns 404 for non-existent
- Test PATCH updates prompt
- Test PATCH returns 404 for non-existent
- Test DELETE removes prompt (204)
- Test DELETE returns 404 for non-existent

**Validation errors (400):**
- Test POST returns 400 on duplicate name
- Test POST returns 400 on invalid name format
- Test POST returns 400 on duplicate argument names
- Test POST returns 400 on invalid argument name format
- Test POST returns 400 on template validation error (undefined var)
- Test POST returns 400 on invalid Jinja syntax
- Test PATCH returns 400 on name collision
- Test PATCH returns 400 on template validation error

---

## Milestone 4: Prompt MCP Server

### Goal
Create the MCP server that serves prompts via HTTP API calls.

### Prerequisites
- Extract shared code from `mcp_server/` into `mcp_common/` package (or import directly from `mcp_server`)

### Success Criteria
- `prompts/list` returns all prompts
- `prompts/get` renders template with arguments
- Authentication via PAT
- All tests pass

### Key Changes

#### 4.0 Code Reuse Strategy

Reuse from existing `backend/src/mcp_server/`:

| Reuse | Source | Target |
|-------|--------|--------|
| API client helpers | `mcp_server/api_client.py` | Import directly or copy to `prompt_mcp_server/` |
| Auth pattern | `mcp_server/auth.py` | Adapt for low-level SDK (uses contextvars instead of FastMCP's `get_http_headers`) |

**Note:** The existing auth uses `fastmcp.server.dependencies.get_http_headers()`. The low-level SDK doesn't have this, so we'll use Python's `contextvars` to pass the token from the ASGI handler to the prompt handlers.

#### 4.1 Prompt Server Implementation

**File:** `backend/src/prompt_mcp_server/server.py` (new)

Uses low-level MCP SDK for dynamic prompt loading:

```python
"""
MCP Prompt Server for the Bookmarks API.

Uses low-level MCP SDK for dynamic prompt loading from database.
"""
import httpx
from mcp import types
from mcp.server.lowlevel import Server
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, INVALID_PARAMS, INTERNAL_ERROR

# Reuse API client helpers from existing MCP server
from mcp_server.api_client import api_get, get_api_base_url, get_default_timeout
from .auth import get_bearer_token, AuthenticationError
from .template_renderer import render_template, TemplateRenderError

server = Server("Bookmarks Prompt Server")

_http_client: httpx.AsyncClient | None = None


async def _get_http_client() -> httpx.AsyncClient:
    """Get or create HTTP client."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=get_api_base_url(),
            timeout=get_default_timeout(),
        )
    return _http_client


def _get_token() -> str:
    """Get Bearer token from context, raising McpError on failure."""
    try:
        return get_bearer_token()
    except AuthenticationError as e:
        raise McpError(ErrorData(code=INVALID_PARAMS, message=str(e)))


def _handle_api_error(e: httpx.HTTPStatusError, context: str = "") -> None:
    """Translate API errors to MCP errors. Always raises."""
    status = e.response.status_code
    if status == 401:
        raise McpError(ErrorData(code=INVALID_PARAMS, message="Invalid or expired token"))
    if status == 404:
        raise McpError(ErrorData(code=INVALID_PARAMS, message=f"{context} not found"))
    raise McpError(ErrorData(code=INTERNAL_ERROR, message=f"API error: {status}"))


@server.list_prompts()
async def list_prompts() -> list[types.Prompt]:
    """List all prompts from the API."""
    client = await _get_http_client()
    token = _get_token()

    try:
        response = await api_get(client, "/prompts/", token)
        prompts = response.get("items", [])

        return [
            types.Prompt(
                name=p["name"],
                title=p.get("title"),
                description=p.get("description"),
                arguments=[
                    types.PromptArgument(
                        name=arg["name"],
                        description=arg.get("description"),
                        required=arg.get("required"),
                    )
                    for arg in p.get("arguments", [])
                ] if p.get("arguments") else None,
            )
            for p in prompts
        ]
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, "prompts")
    except httpx.RequestError as e:
        raise McpError(ErrorData(code=INTERNAL_ERROR, message=f"API unavailable: {e}"))


@server.get_prompt()
async def get_prompt(
    name: str,
    arguments: dict[str, str] | None = None,
) -> types.GetPromptResult:
    """Get and render a prompt by slug."""
    client = await _get_http_client()
    token = _get_token()

    try:
        prompt = await api_get(client, f"/prompts/{name}", token)

        rendered = render_template(
            content=prompt.get("content") or "",
            arguments=prompt.get("arguments", []),
            provided_args=arguments or {},
        )

        return types.GetPromptResult(
            description=prompt.get("description"),
            messages=[
                types.PromptMessage(
                    role="user",
                    content=types.TextContent(type="text", text=rendered),
                ),
            ],
        )
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, f"Prompt '{name}'")
    except httpx.RequestError as e:
        raise McpError(ErrorData(code=INTERNAL_ERROR, message=f"API unavailable: {e}"))
    except TemplateRenderError as e:
        raise McpError(ErrorData(code=INVALID_PARAMS, message=str(e)))
```

#### 4.2 Template Renderer

**File:** `backend/src/prompt_mcp_server/template_renderer.py` (new)

```python
"""Jinja2 template rendering for prompts."""
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateSyntaxError, UndefinedError


_jinja_env = Environment(undefined=StrictUndefined)


class TemplateRenderError(Exception):
    """Raised when template rendering fails."""
    pass


def render_template(
    content: str,
    arguments: list[dict[str, Any]],
    provided_args: dict[str, str],
) -> str:
    """
    Render a Jinja2 template with validation.

    Args:
        content: Jinja2 template string
        arguments: Argument definitions [{name, description, required}]
        provided_args: Arguments provided by user

    Returns:
        Rendered template string

    Raises:
        TemplateRenderError: If validation fails or template has errors
    """
    defined_names = {arg["name"] for arg in arguments}
    # required can be bool | None; treat None as False
    required_names = {arg["name"] for arg in arguments if arg.get("required") is True}

    # Validate no unknown arguments
    unknown = set(provided_args.keys()) - defined_names
    if unknown:
        raise TemplateRenderError(
            f"Unknown argument(s): {', '.join(sorted(unknown))}. "
            f"Valid: {', '.join(sorted(defined_names)) or 'none'}"
        )

    # Validate required arguments present
    missing = required_names - set(provided_args.keys())
    if missing:
        raise TemplateRenderError(
            f"Missing required argument(s): {', '.join(sorted(missing))}"
        )

    # Build context with None defaults for optional args
    render_context = {arg["name"]: None for arg in arguments}
    render_context.update(provided_args)

    if not content:
        return ""

    try:
        template = _jinja_env.from_string(content)
        return template.render(**render_context)
    except TemplateSyntaxError as e:
        raise TemplateRenderError(f"Template syntax error: {e.message}")
    except UndefinedError as e:
        raise TemplateRenderError(f"Template variable error: {e.message}")
```

#### 4.3 Auth Module

**File:** `backend/src/prompt_mcp_server/auth.py` (new)

```python
"""Authentication for Prompt MCP Server using contextvars."""
from contextvars import ContextVar


_current_token: ContextVar[str | None] = ContextVar("current_token", default=None)


class AuthenticationError(Exception):
    """Raised when authentication fails."""
    pass


def set_current_token(token: str) -> None:
    """Set the current request's auth token."""
    _current_token.set(token)


def get_bearer_token() -> str:
    """Get the Bearer token for the current request."""
    token = _current_token.get()
    if not token:
        raise AuthenticationError("No authentication token in context")
    return token
```

#### 4.4 FastAPI Application

**File:** `backend/src/prompt_mcp_server/main.py` (new)

```python
"""FastAPI application for the Prompt MCP Server."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from .server import server as mcp_server

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MCPClosedResourceFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "ClosedResourceError" not in record.getMessage()


logging.getLogger("mcp.server.streamable_http").addFilter(MCPClosedResourceFilter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan."""
    logger.info("Starting Bookmarks Prompt MCP Server")

    mcp_session_manager = StreamableHTTPSessionManager(
        app=mcp_server,
        json_response=True,
        stateless=True,
    )
    app.state.mcp_session_manager = mcp_session_manager

    async with mcp_session_manager.run():
        yield

    logger.info("Prompt MCP Server shutting down")


app = FastAPI(title="Bookmarks Prompt MCP Server", lifespan=lifespan)


async def mcp_asgi_handler(scope: Scope, receive: Receive, send: Send) -> None:
    """Route MCP messages with auth."""
    from .auth import set_current_token

    if not hasattr(scope.get("app").state, "mcp_session_manager"):
        response = JSONResponse({"error": "MCP server not initialized"}, status_code=503)
        await response(scope, receive, send)
        return

    headers = dict(scope.get("headers", []))
    auth_header = headers.get(b"authorization", b"").decode()

    if auth_header.lower().startswith("bearer "):
        set_current_token(auth_header[7:])
    else:
        response = JSONResponse({"error": "Missing Authorization header"}, status_code=401)
        await response(scope, receive, send)
        return

    session_manager = scope["app"].state.mcp_session_manager
    await session_manager.handle_request(scope, receive, send)


app.mount("/mcp", mcp_asgi_handler)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "server": "prompt-mcp"}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("PROMPT_MCP_HOST", "0.0.0.0")
    port = int(os.getenv("PROMPT_MCP_PORT") or os.getenv("PORT") or "8002")
    uvicorn.run(app, host=host, port=port)
```

#### 4.5 Package Files

**File:** `backend/src/prompt_mcp_server/__init__.py`

```python
"""Prompt MCP Server package."""
```

**File:** `backend/src/prompt_mcp_server/__main__.py`

```python
"""Entry point for running the Prompt MCP server."""
import os
import uvicorn

from .main import app

if __name__ == "__main__":
    host = os.getenv("PROMPT_MCP_HOST", "0.0.0.0")
    port = int(os.getenv("PROMPT_MCP_PORT") or os.getenv("PORT") or "8002")
    uvicorn.run(app, host=host, port=port)
```

#### 4.6 Makefile Target

**File:** `Makefile` (update)

```makefile
prompt-server:  ## Start Prompt MCP server
	cd backend && uv run python -m prompt_mcp_server
```

### Testing Strategy

**MCP protocol:**
- Test `list_prompts()` returns MCP Prompt objects
- Test `get_prompt()` renders template correctly
- Test `get_prompt()` for non-existent prompt returns error

**Argument validation at render time:**
- Test `get_prompt()` with missing required argument errors
- Test `get_prompt()` with unknown argument errors
- Test `get_prompt()` with optional argument omitted succeeds

**Template rendering errors:**
- Test `get_prompt()` with invalid Jinja syntax in stored template errors
- Test `get_prompt()` catches UndefinedError at render time

**Authentication:**
- Test missing Authorization header returns 401
- Test invalid token returns 401

**Health:**
- Test health check returns 200

---

## Milestone 5: Frontend - Prompts List & Editor

### Goal
Create UI for managing prompts as a first-class feature.

### Success Criteria
- Prompts section in navigation
- List view of prompts
- Create/edit/delete prompts
- Argument builder
- Template validation feedback
- All tests pass

### Key Changes

#### 5.1 Prompts List Page

**File:** `frontend/src/pages/PromptsPage.tsx` (new)

Features:
- List all prompts with slug, description
- Create new prompt button
- Click to edit
- Delete action

#### 5.2 Prompt Editor

**File:** `frontend/src/pages/PromptEditorPage.tsx` (new)

Features:
- Slug input (prompt name)
- Description textarea
- Content textarea (Jinja2 template)
- Arguments builder:
  - Add/edit/delete arguments
  - Name (validated), description, required checkbox
- Save/cancel buttons
- Template validation errors displayed

#### 5.3 Types

**File:** `frontend/src/types.ts` (update)

```typescript
export interface PromptArgument {
  name: string
  description: string | null
  required: boolean | null  // null treated as false
}

export interface Prompt {
  id: number
  slug: string
  description: string | null
  content: string | null
  arguments: PromptArgument[]
  created_at: string
  updated_at: string
}

export interface PromptCreate {
  slug: string
  description?: string | null
  content?: string | null
  arguments?: PromptArgument[]
}

export interface PromptUpdate {
  slug?: string
  description?: string | null
  content?: string | null
  arguments?: PromptArgument[]
}
```

#### 5.4 API Service

**File:** `frontend/src/services/api.ts` (update)

```typescript
// Prompts
async listPrompts(): Promise<{ items: Prompt[], total: number }> {
  const response = await this.fetch('/prompts/')
  return response.json()
}

async getPrompt(slug: string): Promise<Prompt> {
  const response = await this.fetch(`/prompts/${slug}`)
  return response.json()
}

async createPrompt(data: PromptCreate): Promise<Prompt> {
  const response = await this.fetch('/prompts/', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return response.json()
}

async updatePrompt(slug: string, data: PromptUpdate): Promise<Prompt> {
  const response = await this.fetch(`/prompts/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return response.json()
}

async deletePrompt(slug: string): Promise<void> {
  await this.fetch(`/prompts/${slug}`, { method: 'DELETE' })
}
```

#### 5.5 Navigation

Add "Prompts" to sidebar navigation with a terminal/command icon.

### Testing Strategy

- Test prompts list renders
- Test create new prompt flow
- Test edit prompt flow
- Test delete prompt
- Test validation errors displayed

---

## Milestone 6: Documentation

### Goal
Document the Prompt MCP Server for users.

### Key Changes

- Update README with prompts feature
- Add testing instructions with MCP Inspector
- Example prompts
- Update CLAUDE.md

---

## Milestone 7: Deployment

### Goal
Deploy Prompt MCP Server to production.

### Key Changes

- Add prompt-mcp service to Railway
- Environment variables
- Update README_DEPLOY.md

---

## Summary

| Milestone | Description | Dependencies |
|-----------|-------------|--------------|
| 1 | Database Schema (prompts table) | None |
| 2 | Schemas & Service Layer | 1 |
| 3 | REST API Endpoints | 2 |
| 4 | Prompt MCP Server | 3 |
| 5 | Frontend (list, editor) | 3 |
| 6 | Documentation | All |
| 7 | Deployment | 4 |

## Comparison: Notes-as-Prompts vs Prompt-First

| Aspect | Notes-as-Prompts | Prompt-First |
|--------|------------------|--------------|
| Tables | `notes` + nullable columns | Dedicated `prompts` table |
| Tag config | Required | Not needed |
| Uniqueness | Deduplication logic | DB constraint |
| Validation | Conditional | Always |
| User model | Confusing ("is this a prompt?") | Clear separation |
| API | Reuses notes endpoints | Dedicated endpoints |
| Complexity | High (workarounds) | Low (direct) |

The prompt-first approach is simpler, clearer, and more maintainable.
