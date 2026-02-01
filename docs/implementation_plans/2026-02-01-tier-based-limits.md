# Implementation Plan: Tier-Based Usage Limits

**Date:** 2026-02-01

## Overview

Add tier-based usage limits to prevent abuse and prepare for future pricing tiers. This includes:
- Maximum items per content type (bookmarks, notes, prompts)
- Field length limits (title, content, URL, tag name, argument description)
- User tier assignment stored in database
- Limits enforced at API layer, with frontend UX improvements

## Important: Review Before Implementing

Before implementing any milestone, review:
- Existing service method signatures in `services/bookmark_service.py`, `services/note_service.py`, `services/prompt_service.py`
- Exception handling patterns in `api/routers/*.py`
- Validator conventions in `schemas/validators.py`
- Existing error response patterns for 4xx responses

## Current State

**Existing limits (in `config.py` as env vars):**
- `max_title_length`: 500 (all entities)
- `max_description_length`: 1,000 (all entities)
- `max_content_length`: 512,000 (bookmarks)
- `max_note_content_length`: 500,000 (notes)
- `max_prompt_content_length`: 100,000 (prompts)
- `max_prompt_name_length`: 100
- `max_argument_name_length`: 100

**No limits currently for:**
- Number of items per user
- URL length
- Tag name length
- Prompt argument description length

**Database columns (keeping as safety ceilings - no changes needed):**

| Field | DB Constraint | Tier Limit | Notes |
|-------|---------------|------------|-------|
| title | String(500) | 100 | DB ceiling exceeds tier limit ✓ |
| tag.name | String(100) | 50 | DB ceiling exceeds tier limit ✓ |
| url | Text (none) | 2048 | API-only enforcement |
| content | Text (none) | 100K | API-only enforcement |
| description | Text (none) | 1000 (unchanged) | API-only enforcement |

## Target State

### Tier Limits (defined in code)

```python
from dataclasses import dataclass
from enum import StrEnum

class Tier(StrEnum):
    FREE = "free"
    # PRO = "pro"  # future

@dataclass(frozen=True)
class TierLimits:
    # Item counts
    max_bookmarks: int
    max_notes: int
    max_prompts: int

    # Field lengths (common)
    max_title_length: int
    max_description_length: int
    max_tag_name_length: int

    # Field lengths (content - per entity type)
    max_bookmark_content_length: int
    max_note_content_length: int
    max_prompt_content_length: int

    # Field lengths (entity-specific)
    max_url_length: int  # bookmarks only
    max_prompt_name_length: int  # prompts only
    max_argument_name_length: int  # prompt arguments
    max_argument_description_length: int  # prompt arguments

TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(
        max_bookmarks=100,
        max_notes=100,
        max_prompts=100,
        max_title_length=100,
        max_description_length=1000,
        max_tag_name_length=50,
        max_bookmark_content_length=100_000,
        max_note_content_length=100_000,
        max_prompt_content_length=100_000,
        max_url_length=2048,
        max_prompt_name_length=100,
        max_argument_name_length=100,
        max_argument_description_length=500,
    ),
    # Future tiers will have different values
}

def get_tier_limits(tier: Tier) -> TierLimits:
    """Get limits for a tier."""
    return TIER_LIMITS[tier]
```

**Type safety pattern:**
- DB stores tier as string (`user.tier` column)
- Conversion happens at API boundary (in routers): `Tier(current_user.tier)`
- Services and internal functions use `Tier` enum for type safety
- Invalid tier strings raise `ValueError` at conversion (fail-fast)

### Item Counting Policy

**All rows count toward limits** - including archived and soft-deleted items.

Rationale:
- **Storage abuse prevention**: Users could soft-delete items, create new ones with large content, keep deleted items until auto-purge
- **Simpler implementation**: `COUNT(*) WHERE user_id = ?` - no state filtering
- **Consistent mental model**: Rows = cost

**UX implication**: User deletes something, immediately tries to create → hits limit. This is acceptable because:
1. Permanent delete from trash frees quota (`DELETE /bookmarks/{id}?permanent=true`)
2. Error message guides them: "You're at your limit. Permanently delete items from trash to free space, or upgrade."

### Enforcement Layers

| Layer | Role |
|-------|------|
| **Database** | Safety ceiling only (existing constraints sufficient) |
| **API/Pydantic** | Ceiling validation (catches extreme values) |
| **API/Services** | Tier-specific limit enforcement |
| **Frontend** | UX enforcement (prevents over-typing, shows errors) |

### Error Response Contract

All limit violations return **HTTP 429** with a structured body to distinguish from rate limiting:

**Quota exceeded (item limits):**
```json
{
    "detail": "Bookmark limit reached (100). Permanently delete items from trash to free space, or upgrade.",
    "error_code": "QUOTA_EXCEEDED",
    "resource": "bookmarks",
    "current": 100,
    "limit": 100,
    "retry_after": null
}
```

**Quota exceeded (field limits):**
```json
{
    "detail": "Title exceeds limit of 100 characters",
    "error_code": "FIELD_LIMIT_EXCEEDED",
    "field": "title",
    "current": 150,
    "limit": 100,
    "retry_after": null
}
```

**Rate limiting (for comparison - existing behavior):**
```json
{
    "detail": "Rate limit exceeded",
    "error_code": "RATE_LIMITED",
    "retry_after": 30
}
```

`retry_after: null` signals "this won't resolve by waiting" → frontend shows upgrade prompt.
`retry_after: <seconds>` signals "retry later" → implement backoff.

---

## Milestones

### Milestone 1: Tier Limits Infrastructure

**Goal:** Create the tier limits system and user tier assignment.

**Success Criteria:**
- `TierLimits` dataclass defined with all limits
- `TIER_LIMITS` dict with "free" tier configured
- `get_tier_limits(tier)` function returns appropriate limits
- User model has `tier` column with default "free"
- Migration creates the column
- Tests verify limit retrieval

**Key Changes:**

1. **Create `backend/src/core/tier_limits.py`:**
```python
from dataclasses import dataclass
from enum import StrEnum

class Tier(StrEnum):
    FREE = "free"
    # PRO = "pro"  # future

@dataclass(frozen=True)
class TierLimits:
    # Item counts
    max_bookmarks: int
    max_notes: int
    max_prompts: int

    # Field lengths (common)
    max_title_length: int
    max_description_length: int
    max_tag_name_length: int

    # Field lengths (content - per entity type)
    max_bookmark_content_length: int
    max_note_content_length: int
    max_prompt_content_length: int

    # Field lengths (entity-specific)
    max_url_length: int  # bookmarks only
    max_prompt_name_length: int  # prompts only
    max_argument_name_length: int  # prompt arguments
    max_argument_description_length: int  # prompt arguments

TIER_LIMITS: dict[Tier, TierLimits] = {
    Tier.FREE: TierLimits(
        max_bookmarks=100,
        max_notes=100,
        max_prompts=100,
        max_title_length=100,
        max_description_length=1000,
        max_tag_name_length=50,
        max_bookmark_content_length=100_000,
        max_note_content_length=100_000,
        max_prompt_content_length=100_000,
        max_url_length=2048,
        max_prompt_name_length=100,
        max_argument_name_length=100,
        max_argument_description_length=500,
    ),
}

def get_tier_limits(tier: Tier) -> TierLimits:
    """Get limits for a tier."""
    return TIER_LIMITS[tier]
```

**Type safety note:** The `Tier` enum is used consistently throughout the codebase:
- DB stores string (`user.tier` column)
- Conversion happens at API boundary: `Tier(current_user.tier)`
- Services and internal functions use `Tier` enum
- Invalid tier strings in DB will raise `ValueError` at conversion (fail-fast)

2. **Update `backend/src/models/user.py`:**
   - Add `tier: Mapped[str] = mapped_column(String(50), default="free", server_default="free")`

3. **Create migration:**
   - `make migration message="add tier column to users"`
   - Always use `make migration` command to ensure consistency; NEVER CREATE MIGRATIONS MANUALLY.

**Testing Strategy:**
- Unit tests for `get_tier_limits()` with valid `Tier` enum value
- Test that `Tier("invalid")` raises `ValueError` (fail-fast for invalid tier strings)
- Test that `TierLimits` dataclass is immutable (frozen)
- Integration test that new users get default "free" tier
- Test that `Tier(user.tier)` conversion works for valid DB values

**Dependencies:** None

**Risk Factors:** None - this is additive infrastructure

---

### Milestone 2: API Endpoint for User Limits

**Goal:** Expose user's limits via API so frontend can fetch them.

**Success Criteria:**
- `GET /users/me/limits` returns user's tier limits
- Response includes all limit values
- Endpoint uses existing auth

**Key Changes:**

1. **Create schema in `backend/src/schemas/` (new file or add to existing):**
```python
class UserLimitsResponse(BaseModel):
    tier: str
    max_bookmarks: int
    max_notes: int
    max_prompts: int
    max_title_length: int
    max_description_length: int
    max_tag_name_length: int
    max_bookmark_content_length: int
    max_note_content_length: int
    max_prompt_content_length: int
    max_url_length: int
    max_prompt_name_length: int
    max_argument_name_length: int
    max_argument_description_length: int
```

2. **Add endpoint in `backend/src/api/routers/users.py`:**
```python
from dataclasses import asdict
from core.tier_limits import Tier, get_tier_limits

@router.get("/me/limits", response_model=UserLimitsResponse)
async def get_my_limits(current_user: User = Depends(get_current_user)) -> UserLimitsResponse:
    tier = Tier(current_user.tier)  # Convert string from DB to enum
    limits = get_tier_limits(tier)
    return UserLimitsResponse(
        tier=current_user.tier,
        **asdict(limits),
    )
```

**Testing Strategy:**
- Test endpoint returns correct limits for user's tier
- Test response schema matches expected fields

**Dependencies:** Milestone 1

**Risk Factors:** None

---

### Milestone 3: Item Count Limits in Services

**Goal:** Enforce maximum items per content type when creating or restoring items.

**Success Criteria:**
- Creating bookmark/note/prompt fails with 429 when at limit
- Restoring soft-deleted item fails with 429 when at limit
- Error response includes `error_code: "QUOTA_EXCEEDED"`, resource type, current count, and limit
- All rows count (including archived and soft-deleted)

**Key Changes:**

1. **Add count method to `BaseEntityService`:**
```python
async def count_user_items(self, db: AsyncSession, user_id: UUID) -> int:
    """
    Count ALL items for a user (including archived and soft-deleted).

    All rows count toward limits to prevent storage abuse.
    Users can permanently delete items to free quota.
    """
    result = await db.execute(
        select(func.count(self.model.id))
        .where(self.model.user_id == user_id)
    )
    return result.scalar() or 0
```

2. **Create exceptions in `backend/src/services/exceptions.py`:**
```python
class QuotaExceededError(Exception):
    """Raised when user has reached their item limit for a content type."""

    def __init__(self, resource: str, current: int, limit: int) -> None:
        self.resource = resource
        self.current = current
        self.limit = limit
        super().__init__(
            f"{resource.capitalize()} limit reached ({limit}). "
            "Permanently delete items from trash to free space, or upgrade."
        )

class FieldLimitExceededError(Exception):
    """Raised when a field exceeds tier-specific length limit."""

    def __init__(self, field: str, current: int, limit: int) -> None:
        self.field = field
        self.current = current
        self.limit = limit
        super().__init__(f"{field.capitalize()} exceeds limit of {limit} characters")
```

3. **Update service `create()` methods to accept `tier: Tier` parameter:**

**Files to modify:**
- `services/bookmark_service.py` - `BookmarkService.create()` → check `limits.max_bookmarks`
- `services/note_service.py` - `NoteService.create()` → check `limits.max_notes`
- `services/prompt_service.py` - `PromptService.create()` → check `limits.max_prompts`

```python
from core.tier_limits import Tier, get_tier_limits

# Example: BookmarkService.create() - apply same pattern to NoteService and PromptService
async def create(
    self,
    db: AsyncSession,
    user_id: UUID,
    tier: Tier,
    data: BookmarkCreate,
) -> Bookmark:
    limits = get_tier_limits(tier)
    count = await self.count_user_items(db, user_id)
    if count >= limits.max_bookmarks:
        raise QuotaExceededError("bookmarks", count, limits.max_bookmarks)
    # ... rest of create logic
```

4. **Update service `update()` methods to accept `tier: Tier` parameter:**

`update()` methods also need tier for field validation (users can exceed limits via update).

**Files to modify:**
- `services/bookmark_service.py` - `BookmarkService.update()`
- `services/note_service.py` - `NoteService.update()`
- `services/prompt_service.py` - `PromptService.update()`

```python
# Example: BookmarkService.update() - apply same pattern to NoteService and PromptService
async def update(
    self,
    db: AsyncSession,
    user_id: UUID,
    tier: Tier,  # Add this parameter
    bookmark_id: UUID,
    data: BookmarkUpdate,
) -> Bookmark | None:
    limits = get_tier_limits(tier)
    self._validate_field_limits(data.model_dump(exclude_unset=True), limits)
    # ... rest of update logic
```

5. **Add `limit_attr` class attribute to each service:**

```python
# Each service declares its limit attribute explicitly
class BookmarkService(BaseEntityService[Bookmark]):
    model = Bookmark
    entity_name = "Bookmark"
    limit_attr = "max_bookmarks"  # Explicit mapping to TierLimits attribute

class NoteService(BaseEntityService[Note]):
    model = Note
    entity_name = "Note"
    limit_attr = "max_notes"

class PromptService(BaseEntityService[Prompt]):
    model = Prompt
    entity_name = "Prompt"
    limit_attr = "max_prompts"
```

6. **Update `restore()` method in `BaseEntityService`:**

```python
async def restore(
    self,
    db: AsyncSession,
    user_id: UUID,
    tier: Tier,  # Add this parameter
    entity_id: UUID,
) -> T | None:
    # Check limit before restoring
    limits = get_tier_limits(tier)
    count = await self.count_user_items(db, user_id)
    max_items = getattr(limits, self.limit_attr)  # Uses explicit class attribute
    if count >= max_items:
        raise QuotaExceededError(f"{self.entity_name.lower()}s", count, max_items)
    # ... rest of restore logic
```

7. **Update routers to convert tier string to enum and handle exceptions:**

**Files to modify:**
- `api/routers/bookmarks.py` - `create_bookmark()`, `update_bookmark()`, `restore_bookmark()`
- `api/routers/notes.py` - `create_note()`, `update_note()`, `restore_note()`
- `api/routers/prompts.py` - `create_prompt()`, `update_prompt()`, `restore_prompt()`

```python
from core.tier_limits import Tier

# Example: routers/bookmarks.py - apply same pattern to notes.py and prompts.py
@router.post("/", response_model=BookmarkResponse, status_code=201)
async def create_bookmark(
    data: BookmarkCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> BookmarkResponse:
    try:
        tier = Tier(current_user.tier)  # Convert string from DB to enum at boundary
        bookmark = await bookmark_service.create(
            db, current_user.id, tier, data
        )
        # ...
    except QuotaExceededError as e:
        raise HTTPException(
            status_code=429,
            detail={
                "detail": str(e),
                "error_code": "QUOTA_EXCEEDED",
                "resource": e.resource,
                "current": e.current,
                "limit": e.limit,
                "retry_after": None,
            },
        )
```

**Testing Strategy:**

**Mock the limits** - Patch `TIER_LIMITS` or `get_tier_limits()` to return small limits (e.g., 2-3 items) for faster tests that don't break when limits change:

```python
@pytest.fixture
def low_limits(monkeypatch):
    """Patch tier limits to small values for testing."""
    test_limits = TierLimits(
        max_bookmarks=2,
        max_notes=2,
        max_prompts=2,
        max_title_length=10,
        max_description_length=50,
        max_tag_name_length=10,
        max_bookmark_content_length=100,
        max_note_content_length=100,
        max_prompt_content_length=100,
        max_url_length=100,
        max_prompt_name_length=10,
        max_argument_name_length=10,
        max_argument_description_length=20,
    )
    monkeypatch.setattr("core.tier_limits.TIER_LIMITS", {Tier.FREE: test_limits})
    return test_limits
```

**Test cases:**
- Create items up to mocked limit (2-3), verify next create fails with 429
- Verify soft-deleted items count toward limit
- Verify archived items count toward limit
- Verify restore fails with 429 when at limit
- Verify permanent delete frees quota (create succeeds after permanent delete)
- Verify error response structure (error_code, resource, current, limit, retry_after)
- Test each content type (bookmarks, notes, prompts)

**Dependencies:** Milestone 1

**Risk Factors:**
- Service method signatures change - update all callers (routers, tests)
- MCP servers call API via HTTP, so they're unaffected by service signature changes

---

### Milestone 4: Field Length Validation Updates

**Goal:** Update validators to use tier-based limits for field lengths.

**Success Criteria:**
- Title validation enforced at tier limit (100 chars for free)
- Content validation unified at tier limit (100K for all types)
- URL validation added (2048 chars)
- Tag name validation added (50 chars)
- Argument description validation added (500 chars)
- Consistent error response shape for all field limit violations

**Key Changes:**

The validation happens in two layers:
1. **Schema validators (ceiling)**: Catch obviously invalid input early with generous limits
2. **Service validators (tier-specific)**: Enforce user's actual tier limits

1. **Update `backend/src/schemas/validators.py` with ceiling values:**

```python
# Ceiling values - generous limits that exceed any tier
# Tier-specific limits are enforced in services
MAX_TITLE_CEILING = 500  # DB column is String(500)
MAX_CONTENT_CEILING = 500_000  # Safety ceiling
MAX_URL_CEILING = 8192  # Safety ceiling
MAX_TAG_NAME_CEILING = 100  # DB column is String(100)
MAX_ARG_DESC_CEILING = 1000  # Safety ceiling

def validate_url_length(url: str) -> str:
    """Validate URL doesn't exceed ceiling."""
    if len(str(url)) > MAX_URL_CEILING:
        raise ValueError(f"URL exceeds maximum length of {MAX_URL_CEILING}")
    return url

def validate_tag_name_length(tag: str) -> str:
    """Validate tag name doesn't exceed ceiling."""
    if len(tag) > MAX_TAG_NAME_CEILING:
        raise ValueError(f"Tag name exceeds maximum length of {MAX_TAG_NAME_CEILING}")
    return tag

def validate_argument_description_length(desc: str | None) -> str | None:
    """Validate argument description doesn't exceed ceiling."""
    if desc is not None and len(desc) > MAX_ARG_DESC_CEILING:
        raise ValueError(f"Argument description exceeds maximum length of {MAX_ARG_DESC_CEILING}")
    return desc
```

2. **Add shared validation helper to `BaseEntityService`:**

```python
def _validate_common_field_limits(self, data: dict, limits: TierLimits) -> None:
    """
    Validate common fields against tier limits.

    Subclasses should call this and add entity-specific validation (including content length).
    """
    if "title" in data and data["title"]:
        if len(data["title"]) > limits.max_title_length:
            raise FieldLimitExceededError("title", len(data["title"]), limits.max_title_length)
    if "description" in data and data["description"]:
        if len(data["description"]) > limits.max_description_length:
            raise FieldLimitExceededError("description", len(data["description"]), limits.max_description_length)
```

Note: Content length validation is entity-specific (each has different limit), so it belongs in the entity service's `_validate_field_limits()` method.

3. **Add entity-specific validation in services:**

**Files to modify:**
- `services/bookmark_service.py` - `_validate_field_limits()` with URL + content + tag validation
- `services/note_service.py` - `_validate_field_limits()` with content + tag validation
- `services/prompt_service.py` - `_validate_field_limits()` with content + argument description + tag validation

**Tag name validation:** Validate tag names in the calling service's `_validate_field_limits()` method *before* passing to `get_or_create_tags()`. This keeps `tag_service.py` focused on get/create logic and avoids changing its signature.

```python
# BookmarkService
def _validate_field_limits(self, data: dict, limits: TierLimits) -> None:
    self._validate_common_field_limits(data, limits)
    if "content" in data and data["content"]:
        if len(data["content"]) > limits.max_bookmark_content_length:
            raise FieldLimitExceededError("content", len(data["content"]), limits.max_bookmark_content_length)
    if "url" in data and data["url"]:
        if len(str(data["url"])) > limits.max_url_length:
            raise FieldLimitExceededError("url", len(str(data["url"])), limits.max_url_length)
    # Validate tag names before passing to get_or_create_tags()
    if "tags" in data and data["tags"]:
        for tag in data["tags"]:
            if len(tag) > limits.max_tag_name_length:
                raise FieldLimitExceededError("tag", len(tag), limits.max_tag_name_length)

# NoteService
def _validate_field_limits(self, data: dict, limits: TierLimits) -> None:
    self._validate_common_field_limits(data, limits)
    if "content" in data and data["content"]:
        if len(data["content"]) > limits.max_note_content_length:
            raise FieldLimitExceededError("content", len(data["content"]), limits.max_note_content_length)
    # Validate tag names before passing to get_or_create_tags()
    if "tags" in data and data["tags"]:
        for tag in data["tags"]:
            if len(tag) > limits.max_tag_name_length:
                raise FieldLimitExceededError("tag", len(tag), limits.max_tag_name_length)

# PromptService
def _validate_field_limits(self, data: dict, limits: TierLimits) -> None:
    self._validate_common_field_limits(data, limits)
    if "content" in data and data["content"]:
        if len(data["content"]) > limits.max_prompt_content_length:
            raise FieldLimitExceededError("content", len(data["content"]), limits.max_prompt_content_length)
    # Validate tag names before passing to get_or_create_tags()
    if "tags" in data and data["tags"]:
        for tag in data["tags"]:
            if len(tag) > limits.max_tag_name_length:
                raise FieldLimitExceededError("tag", len(tag), limits.max_tag_name_length)
    # Also validate argument descriptions...
```

4. **Update `PromptArgument` schema** to validate description length

5. **Update bookmark schema** to validate URL length (ceiling)

6. **Update tag validation** in `validate_and_normalize_tag()` to check name length

7. **Handle `FieldLimitExceededError` in routers:**

```python
except FieldLimitExceededError as e:
    raise HTTPException(
        status_code=429,
        detail={
            "detail": str(e),
            "error_code": "FIELD_LIMIT_EXCEEDED",
            "field": e.field,
            "current": e.current,
            "limit": e.limit,
            "retry_after": None,
        },
    )
```

**Testing Strategy:**

**Mock the limits** - Use the same `low_limits` fixture from Milestone 3 to test field validation without depending on actual limit values:

```python
# With low_limits fixture setting max_title_length=10
def test_title_exceeds_tier_limit(low_limits, ...):
    response = await client.post("/bookmarks/", json={"url": "...", "title": "A" * 11})
    assert response.status_code == 429
    assert response.json()["error_code"] == "FIELD_LIMIT_EXCEEDED"
```

**Test cases:**
- Test ceiling validation catches extreme values (e.g., title > 500 chars)
- Test tier-specific validation with mocked low limits (e.g., title > 10 chars with `max_title_length=10`)
- Test each field type: title, description, content, URL, tag name, argument description
- Test tag name validation happens before `get_or_create_tags()` is called
- Test error response structure matches contract
- Test that ceiling and service errors have consistent shape

**Dependencies:** Milestone 1

**Risk Factors:**
- Two-layer validation adds complexity - ensure error messages are clear about which limit was hit
- Tag validation touches shared validator used across all entities

---

### Milestone 5: Remove Legacy Config Settings

**Goal:** Clean up old config settings that are now replaced by tier limits.

**Success Criteria:**
- Remove from `config.py`: `max_title_length`, `max_description_length`, `max_content_length`, `max_note_content_length`, `max_prompt_content_length`, `max_prompt_name_length`, `max_argument_name_length`
- Update any code still referencing old settings
- Update frontend `config.ts` to remove corresponding values

**Key Changes:**

1. **Update `backend/src/core/config.py`:**
   - Remove `max_title_length`
   - Remove `max_description_length`
   - Remove `max_content_length`
   - Remove `max_note_content_length`
   - Remove `max_prompt_content_length`
   - Remove `max_prompt_name_length`
   - Remove `max_argument_name_length`

2. **Update `frontend/src/config.ts`:**
   - Remove `maxTitleLength`
   - Remove `maxDescriptionLength`
   - Remove `maxContentLength`
   - Remove `maxNoteContentLength`
   - Remove `maxPromptContentLength`
   - Remove `maxPromptNameLength`
   - Remove `maxArgumentNameLength`
   - Frontend will fetch all limits from API instead

3. **Search codebase** for any remaining references to these settings:
   - `grep -r "max_title_length\|max_description_length\|max_content_length\|max_note_content_length\|max_prompt_content_length\|max_prompt_name_length\|max_argument_name_length"`
   - Update validators that reference `get_settings()` for these values

**Testing Strategy:**
- Verify application starts without old settings
- Verify no runtime errors from missing settings
- Run full test suite to catch any missed references

**Dependencies:** Milestones 1-4

**Risk Factors:**
- May miss some references - thorough grep needed
- Some tests may reference old settings

---

### Milestone 6: Frontend Limits Integration

**Goal:** Frontend fetches and uses tier limits, with improved UX for limit violations.

**Success Criteria:**
- Frontend fetches limits from `/users/me/limits` on auth
- All components use API-fetched limits instead of hardcoded `config.limits.*`
- Forms are disabled until limits are loaded
- Character counters use fetched limits
- Settings page displays tier and limits
- Clear error messages when limits exceeded
- Distinguish quota errors from rate limit errors (check `retry_after`)

**Key Changes:**

1. **Create limits hook:**
```typescript
// hooks/useLimits.ts
export function useLimits() {
    const { data: limits, isLoading } = useQuery({
        queryKey: ['user-limits'],
        queryFn: () => api.get('/users/me/limits'),
        staleTime: Infinity,  // Limits rarely change, cache until page refresh
        gcTime: Infinity,     // Keep in cache indefinitely
    })
    return { limits, isLoading }
}
```

**Caching strategy:**
- `staleTime: Infinity` - limits don't change during normal usage
- Page refresh clears React Query's in-memory cache, fetching fresh limits
- If user upgrades tier (future feature), they refresh the page to see new limits
- No need for manual cache invalidation or "refresh limits" button

2. **Fetch limits alongside user on auth:**
   - In the auth initialization, trigger both `/users/me` and `/users/me/limits` queries
   - Both should complete before app considers user "ready"

3. **Remove hardcoded limits from `config.ts`:**

Remove all limit settings from `frontend/src/config.ts`:
- `maxContentLength`
- `maxNoteContentLength`
- `maxPromptContentLength`
- `maxTitleLength`
- `maxDescriptionLength`
- `maxPromptNameLength`
- `maxArgumentNameLength`

All limits are now fetched from `/users/me/limits` API.

4. **Update components to use fetched limits:**

**Files to modify:**

| File | Current Usage | Change |
|------|---------------|--------|
| `components/Bookmark.tsx` | `config.limits.maxTitleLength`, `maxDescriptionLength`, `maxContentLength` | Use corresponding limits from `useLimits()` |
| `components/Note.tsx` | `config.limits.maxTitleLength`, `maxDescriptionLength`, `maxNoteContentLength` | Use corresponding limits from `useLimits()` |
| `components/Prompt.tsx` | `config.limits.maxTitleLength`, `maxPromptContentLength`, `maxPromptNameLength`, `maxArgumentNameLength` | Use corresponding limits from `useLimits()` |
| `components/ContentEditor.tsx` | Receives `maxLength` prop | No change needed (already prop-based) |
| `components/InlineEditableText.tsx` | Receives `maxLength` prop | No change needed (already prop-based) |

Each component should:
- Call `useLimits()` hook
- Show loading state while `isLoading` is true
- Pass fetched limits to child components (`ContentEditor`, `InlineEditableText`)

5. **Add tier and limits display in Settings:**

Update `pages/settings/SettingsGeneral.tsx` to show account tier and limits:

```typescript
// In SettingsGeneral.tsx
const { limits, isLoading } = useLimits()

// In the Account section, add:
<div className="border-t pt-6">
  <h3 className="text-lg font-medium text-gray-900">Plan & Limits</h3>
  <div className="mt-4">
    <div className="mb-4">
      <span className="text-sm text-gray-500">Current Plan:</span>
      <span className="ml-2 font-medium capitalize">{limits?.tier}</span>
    </div>
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b">
          <th className="text-left py-2">Resource</th>
          <th className="text-right py-2">Limit</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Bookmarks</td><td className="text-right">{limits?.max_bookmarks}</td></tr>
        <tr><td>Notes</td><td className="text-right">{limits?.max_notes}</td></tr>
        <tr><td>Prompts</td><td className="text-right">{limits?.max_prompts}</td></tr>
        <tr><td>Title length</td><td className="text-right">{limits?.max_title_length} chars</td></tr>
        <tr><td>Description length</td><td className="text-right">{limits?.max_description_length?.toLocaleString()} chars</td></tr>
        <tr><td>Bookmark content</td><td className="text-right">{limits?.max_bookmark_content_length?.toLocaleString()} chars</td></tr>
        <tr><td>Note content</td><td className="text-right">{limits?.max_note_content_length?.toLocaleString()} chars</td></tr>
        <tr><td>Prompt content</td><td className="text-right">{limits?.max_prompt_content_length?.toLocaleString()} chars</td></tr>
        <tr><td>Prompt name</td><td className="text-right">{limits?.max_prompt_name_length} chars</td></tr>
        <tr><td>URL length</td><td className="text-right">{limits?.max_url_length?.toLocaleString()} chars</td></tr>
        <tr><td>Tag name</td><td className="text-right">{limits?.max_tag_name_length} chars</td></tr>
        <tr><td>Argument name</td><td className="text-right">{limits?.max_argument_name_length} chars</td></tr>
        <tr><td>Argument description</td><td className="text-right">{limits?.max_argument_description_length} chars</td></tr>
      </tbody>
    </table>
  </div>
</div>
```

6. **Handle 429 errors with `error_code` distinction:**
```typescript
if (error.response?.status === 429) {
    const data = error.response.data
    if (data.error_code === 'QUOTA_EXCEEDED') {
        // Show upgrade prompt, don't retry
        showQuotaError(data)
    } else if (data.error_code === 'RATE_LIMITED') {
        // Implement backoff based on retry_after
        scheduleRetry(data.retry_after)
    }
}
```

**Testing Strategy:**
- Test limits are fetched on login
- Test forms are disabled while limits are loading
- Test title input stops accepting chars at limit (`maxLength`)
- Test character counters display correct limit values from API
- Test error handling distinguishes quota from rate limit errors
- Test Settings page displays tier and limits table
- Test page refresh fetches fresh limits

**Dependencies:** Milestone 2

**Risk Factors:**
- Need to ensure limits are loaded before forms render - use loading states
- Components need graceful handling when `limits` is undefined during initial load

---

## Summary of Changes by File

### Backend

| File | Changes |
|------|---------|
| `core/tier_limits.py` | New file - tier definitions and lookup |
| `models/user.py` | Add `tier` column |
| `schemas/` (new or existing) | Add `UserLimitsResponse` |
| `schemas/validators.py` | Add ceiling validators for URL, tag name, arg description |
| `schemas/bookmark.py` | Add URL length validation (ceiling) |
| `schemas/prompt.py` | Add argument description validation |
| `api/routers/users.py` | Add `/me/limits` endpoint |
| `services/exceptions.py` | Add `QuotaExceededError`, `FieldLimitExceededError` |
| `services/base_entity_service.py` | Add `count_user_items()`, `_validate_common_field_limits()`, update `restore()` with `Tier` param |
| `services/bookmark_service.py` | Add `limit_attr`, add `Tier` param to `create()` and `update()`, add `_validate_field_limits()` |
| `services/note_service.py` | Add `limit_attr`, add `Tier` param to `create()` and `update()`, add `_validate_field_limits()` |
| `services/prompt_service.py` | Add `limit_attr`, add `Tier` param to `create()` and `update()`, add `_validate_field_limits()` |
| `api/routers/bookmarks.py` | Update `create`, `update`, `restore` to convert tier and pass to service, handle quota/field errors |
| `api/routers/notes.py` | Update `create`, `update`, `restore` to convert tier and pass to service, handle quota/field errors |
| `api/routers/prompts.py` | Update `create`, `update`, `restore` to convert tier and pass to service, handle quota/field errors |
| `core/config.py` | Remove legacy limit settings |

### Frontend

| File | Changes |
|------|---------|
| `hooks/useLimits.ts` | New hook to fetch/cache limits (`staleTime: Infinity`) |
| `config.ts` | Remove all limit settings (now fetched from API) |
| `components/Bookmark.tsx` | Use `useLimits()` instead of `config.limits.*` |
| `components/Note.tsx` | Use `useLimits()` instead of `config.limits.*` |
| `components/Prompt.tsx` | Use `useLimits()` instead of `config.limits.*` |
| `pages/settings/SettingsGeneral.tsx` | Add "Plan & Limits" section with tier and limits table |
| Auth initialization | Fetch limits alongside user query |
| Error handling | Distinguish QUOTA_EXCEEDED from RATE_LIMITED |

### Database

| Migration | Changes |
|-----------|---------|
| Add tier column | `ALTER TABLE users ADD COLUMN tier VARCHAR(50) DEFAULT 'free'` |

---

## Removed from Original Plan

**Milestone 7 (DB Column Adjustments)** - Removed. Current DB constraints already exceed tier limits and serve as adequate safety ceilings. No migration needed.
