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
    name: str                              # Required - prompt identifier
    title: str | None = None               # Optional - display name for UI
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
| Duplicate names | Deduplication by `updated_at` | Unique constraint `(user_id, name)` |
| Name collisions | UI warning, "winner" logic | DB enforces uniqueness |
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
- Invalid Jinja2 syntax rejected (e.g., `{{ unclosed` fails immediately)

### Naming Conventions

**Important distinction:**
- **Prompt names** use hyphens: `code-review`, `explain-code`
- **Argument names** use underscores: `code_to_review`, `language`

This difference is intentional:
- Prompt names are URL-friendly identifiers (hyphens preferred)
- Argument names must be valid Jinja2/Python identifiers (underscores required, hyphens not allowed)

The frontend editor should provide hint text explaining this to users.

### 5. Prompt Fields → MCP Fields

| Prompt Field | MCP Field | Notes |
|--------------|-----------|-------|
| `name` | `name` | MCP prompt identifier |
| `title` | `title` | Optional display name |
| `description` | `description` | Optional |
| `content` | Template | Jinja2 template |
| `arguments` | `arguments` | List of argument definitions |

### 6. Rate Limiting

Prompt endpoints follow the same rate limiting tiers as bookmarks:

| Auth Type | Operation | Per Minute | Per Day |
|-----------|-----------|------------|---------|
| PAT | Read (GET) | 120 | 2000 |
| PAT | Write (POST/PATCH/DELETE) | 60 | 2000 |
| Auth0 | Read | 300 | 4000 |
| Auth0 | Write | 90 | 4000 |

Rate limiting is applied via the existing `rate_limiter` middleware. No sensitive operations (external HTTP) are performed by prompt endpoints, so the `sensitive` tier is not used.

### 7. Authentication

All prompt endpoints use `get_current_user`, which accepts both Auth0 JWTs and Personal Access Tokens (PATs). This is appropriate because:
- No external HTTP requests are made (unlike `fetch-metadata`)
- PAT access enables legitimate automation use cases
- Rate limiting provides abuse protection

### 8. Port Allocation

| Service | Port | Description |
|---------|------|-------------|
| Main API | 8000 | REST API |
| Bookmarks MCP Server | 8001 | Tools (search, create bookmarks) |
| **Prompt MCP Server** | **8002** | Prompts capability |

---

## Milestone 1: Database Schema

### Goal
Create the `prompts` table with proper constraints.

### Success Criteria
- Migration creates `prompts` table
- Unique constraint on `(user_id, name)`
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
# Add TYPE_CHECKING import at top of file
if TYPE_CHECKING:
    from models.prompt import Prompt  # Add this line

# Add relationship in User class
prompts: Mapped[list["Prompt"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan",
)
```

#### 1.3 Update Model Exports

**File:** `backend/src/models/__init__.py` (update)

```python
from models.prompt import Prompt

__all__ = [
    # ... existing exports ...
    "Prompt",
]
```

#### 1.4 Create Migration

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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt
from schemas.prompt import PromptCreate, PromptUpdate


_jinja_env = Environment()


def validate_template(content: str | None, arguments: list[dict[str, Any]]) -> None:
    """
    Validate Jinja2 template syntax and variables.

    Raises:
        ValueError: If template has invalid syntax or uses undefined variables.
    """
    if not content:
        return

    # Validate syntax first - don't swallow syntax errors
    try:
        ast = _jinja_env.parse(content)
    except TemplateSyntaxError as e:
        raise ValueError(f"Invalid Jinja2 syntax: {e.message}")

    # Check for undefined variables
    template_vars = meta.find_undeclared_variables(ast)
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
        # Validate template first (fast fail before DB operations)
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

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            # Check if it's a unique constraint violation
            if "uq_prompts_user_name" in str(e.orig):
                raise ValueError(f"Prompt with name '{data.name}' already exists")
            raise  # Re-raise unexpected integrity errors

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
        new_name = update_data.get("name")
        for field, value in update_data.items():
            if field == "arguments":
                setattr(prompt, field, args_as_dicts)
            else:
                setattr(prompt, field, value)

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            if "uq_prompts_user_name" in str(e.orig) and new_name:
                raise ValueError(f"Prompt with name '{new_name}' already exists")
            raise

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
- Test invalid Jinja syntax rejected on create (e.g., `{{ unclosed`)
- Test invalid Jinja syntax rejected on update
- Test valid template with matching arguments passes
- Test empty content passes validation

**Concurrency:**
- Test concurrent creates with same name: one succeeds, one fails with 400

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
- Test POST returns 400 on invalid Jinja syntax (e.g., `{{ unclosed`)
- Test PATCH returns 400 on name collision
- Test PATCH returns 400 on template validation error
- Test PATCH returns 400 on invalid Jinja syntax

**Concurrency:**
- Test concurrent POST with same name: one succeeds (201), one fails (400)

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
        # Use high limit since MCP clients expect all prompts in one call
        # API max is 100 per request; most users won't have >100 prompts
        response = await api_get(client, "/prompts/", token, params={"limit": 100})
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
    """Get and render a prompt by name."""
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


def clear_current_token() -> None:
    """Clear the current request's auth token (call after request completes)."""
    _current_token.set(None)


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
    from .auth import set_current_token, clear_current_token

    # Defensive null check for app
    app = scope.get("app")
    if not app or not hasattr(app.state, "mcp_session_manager"):
        response = JSONResponse({"error": "MCP server not initialized"}, status_code=503)
        await response(scope, receive, send)
        return

    headers = dict(scope.get("headers", []))
    auth_header = headers.get(b"authorization", b"").decode()

    if not auth_header.lower().startswith("bearer "):
        response = JSONResponse({"error": "Missing Authorization header"}, status_code=401)
        await response(scope, receive, send)
        return

    # Set token for request context
    set_current_token(auth_header[7:])
    try:
        session_manager = app.state.mcp_session_manager
        await session_manager.handle_request(scope, receive, send)
    finally:
        # Clean up token after request (good hygiene for long-lived contexts)
        clear_current_token()


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
- Test `list_prompts()` returns MCP Prompt objects with correct fields
- Test `list_prompts()` includes title when set, omits when null
- Test `list_prompts()` uses limit=100 (verify API called with param)
- Test `get_prompt()` renders template correctly
- Test `get_prompt()` for non-existent prompt returns INVALID_PARAMS error
- Test `get_prompt()` returns rendered content as PromptMessage with role="user"

**Argument validation at render time:**
- Test `get_prompt()` with missing required argument returns INVALID_PARAMS error
- Test `get_prompt()` with unknown argument returns INVALID_PARAMS error
- Test `get_prompt()` with optional argument omitted succeeds (uses None)
- Test `get_prompt()` with empty arguments dict succeeds for prompts with no args

**Template rendering errors:**
- Test `get_prompt()` with invalid Jinja syntax in stored template returns INVALID_PARAMS error
- Test `get_prompt()` catches UndefinedError at render time
- Test `get_prompt()` with empty content returns empty string

**Authentication:**
- Test missing Authorization header returns 401
- Test invalid token returns 401 (API responds with 401)
- Test valid token passes through to API

**Context cleanup:**
- Test auth token is cleared after request (verify contextvar reset)

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
- List all prompts with name, title (if set), description
- Create new prompt button
- Click to edit
- Delete action

#### 5.2 Prompt Editor

**File:** `frontend/src/pages/PromptEditorPage.tsx` (new)

Features:
- Name input (prompt identifier, validated)
- Title input (optional display name)
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
  name: string
  title: string | null
  description: string | null
  content: string | null
  arguments: PromptArgument[]
  created_at: string
  updated_at: string
}

export interface PromptCreate {
  name: string
  title?: string | null
  description?: string | null
  content?: string | null
  arguments?: PromptArgument[]
}

export interface PromptUpdate {
  name?: string
  title?: string | null
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

async getPrompt(name: string): Promise<Prompt> {
  const response = await this.fetch(`/prompts/${name}`)
  return response.json()
}

async createPrompt(data: PromptCreate): Promise<Prompt> {
  const response = await this.fetch('/prompts/', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return response.json()
}

async updatePrompt(name: string, data: PromptUpdate): Promise<Prompt> {
  const response = await this.fetch(`/prompts/${name}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  return response.json()
}

async deletePrompt(name: string): Promise<void> {
  await this.fetch(`/prompts/${name}`, { method: 'DELETE' })
}
```

#### 5.5 React Query Hooks

**File:** `frontend/src/hooks/usePrompts.ts` (new)

Follow existing hook patterns (see `useBookmarks.ts`, `useNotes.ts`).

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import type { Prompt, PromptCreate, PromptUpdate } from '../types'

// Query keys for cache management
export const promptKeys = {
  all: ['prompts'] as const,
  lists: () => [...promptKeys.all, 'list'] as const,
  list: () => [...promptKeys.lists()] as const,
  details: () => [...promptKeys.all, 'detail'] as const,
  detail: (name: string) => [...promptKeys.details(), name] as const,
}

// List all prompts
export function usePromptsQuery() {
  return useQuery({
    queryKey: promptKeys.list(),
    queryFn: () => api.listPrompts(),
  })
}

// Get single prompt by name
export function usePromptQuery(name: string) {
  return useQuery({
    queryKey: promptKeys.detail(name),
    queryFn: () => api.getPrompt(name),
    enabled: !!name,
  })
}

// Create prompt mutation
export function useCreatePrompt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: PromptCreate) => api.createPrompt(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.lists() })
    },
  })
}

// Update prompt mutation
export function useUpdatePrompt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: PromptUpdate }) =>
      api.updatePrompt(name, data),
    onSuccess: (updatedPrompt) => {
      // Invalidate list and update detail cache
      queryClient.invalidateQueries({ queryKey: promptKeys.lists() })
      queryClient.setQueryData(promptKeys.detail(updatedPrompt.name), updatedPrompt)
    },
  })
}

// Delete prompt mutation
export function useDeletePrompt() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.deletePrompt(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: promptKeys.lists() })
      queryClient.removeQueries({ queryKey: promptKeys.detail(name) })
    },
  })
}
```

**Cache Invalidation Strategy:**
- Create: Invalidate list (new item appears)
- Update: Invalidate list + update detail cache (optimistic)
- Delete: Invalidate list + remove detail cache

#### 5.6 Navigation

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
