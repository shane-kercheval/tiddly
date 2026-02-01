# Implementation Plan: Tier-Based Usage Limits

**Date:** 2026-02-01

## Overview

Add tier-based usage limits to prevent abuse and prepare for future pricing tiers. This includes:
- Maximum items per content type (bookmarks, notes, prompts)
- Field length limits (title, content, URL, tag name, argument description)
- User tier assignment stored in database
- Limits enforced at API layer, with frontend UX improvements

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

**Database columns:**
- Title: `String(500)` - hard DB constraint
- Content: `Text` - no constraint
- URL: `Text` - no constraint

## Target State

### Tier Limits (defined in code)

```python
@dataclass(frozen=True)
class TierLimits:
    # Item counts (separate for future tier differentiation)
    max_bookmarks: int
    max_notes: int
    max_prompts: int

    # Field lengths
    max_title_length: int
    max_content_length: int  # applies to all content types
    max_url_length: int
    max_tag_name_length: int
    max_argument_description_length: int

TIER_LIMITS = {
    "free": TierLimits(
        max_bookmarks=100,
        max_notes=100,
        max_prompts=100,
        max_title_length=100,
        max_content_length=100_000,
        max_url_length=2048,
        max_tag_name_length=50,
        max_argument_description_length=500,
    ),
    # Future tiers will have different values
}
```

### Database Changes

- Add `tier` column to `User` model (default: "free")
- Keep title column as `String(255)` (ceiling for future tiers, not enforcement)
- Content/URL remain as `Text` (enforcement at API layer only)

### Enforcement Layers

| Layer | Role |
|-------|------|
| **Database** | Safety ceiling only (max any tier could have) |
| **API/Pydantic** | Enforces tier-specific limits |
| **Frontend** | UX enforcement (prevents over-typing, shows errors) |

---

## Milestones

### Milestone 1: Tier Limits Infrastructure

**Goal:** Create the tier limits system and user tier assignment.

**Success Criteria:**
- `TierLimits` dataclass defined with all limits
- `TIER_LIMITS` dict with "free" tier configured
- `get_user_limits(user)` function returns appropriate limits
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
    max_bookmarks: int
    max_notes: int
    max_prompts: int
    max_title_length: int
    max_content_length: int
    max_url_length: int
    max_tag_name_length: int
    max_argument_description_length: int

TIER_LIMITS: dict[str, TierLimits] = {
    Tier.FREE: TierLimits(
        max_bookmarks=100,
        max_notes=100,
        max_prompts=100,
        max_title_length=100,
        max_content_length=100_000,
        max_url_length=2048,
        max_tag_name_length=50,
        max_argument_description_length=500,
    ),
}

def get_tier_limits(tier: str) -> TierLimits:
    """Get limits for a tier, defaulting to FREE if unknown."""
    return TIER_LIMITS.get(tier, TIER_LIMITS[Tier.FREE])
```

2. **Update `backend/src/models/user.py`:**
   - Add `tier: Mapped[str] = mapped_column(String(50), default="free", server_default="free")`

3. **Create migration:**
   - `make migration message="add tier column to users"`

**Testing Strategy:**
- Unit tests for `get_tier_limits()` with valid tier, unknown tier
- Test that `TierLimits` dataclass is immutable (frozen)
- Integration test that new users get default "free" tier

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

1. **Create schema in `backend/src/schemas/user.py`:**
```python
class UserLimitsResponse(BaseModel):
    tier: str
    max_bookmarks: int
    max_notes: int
    max_prompts: int
    max_title_length: int
    max_content_length: int
    max_url_length: int
    max_tag_name_length: int
    max_argument_description_length: int
```

2. **Add endpoint in `backend/src/api/routers/users.py`:**
```python
@router.get("/me/limits", response_model=UserLimitsResponse)
async def get_my_limits(current_user: User = Depends(get_current_user)):
    limits = get_tier_limits(current_user.tier)
    return UserLimitsResponse(
        tier=current_user.tier,
        **asdict(limits),
    )
```

**Testing Strategy:**
- Test endpoint returns correct limits for user's tier
- Test with different tiers (when we have them)

**Dependencies:** Milestone 1

**Risk Factors:** None

---

### Milestone 3: Item Count Limits in Services

**Goal:** Enforce maximum items per content type when creating new items.

**Success Criteria:**
- Creating bookmark/note/prompt fails with 403 when at limit
- Error message clearly states the limit
- Existing items are not affected

**Key Changes:**

1. **Add count method to `BaseEntityService`:**
```python
async def count_user_items(self, db: AsyncSession, user_id: UUID) -> int:
    """Count non-deleted items for a user."""
    result = await db.execute(
        select(func.count(self.model.id))
        .where(self.model.user_id == user_id)
        .where(self.model.deleted_at.is_(None))
    )
    return result.scalar() or 0
```

2. **Add limit check in each service's `create()` method:**
```python
# In BookmarkService.create()
limits = get_tier_limits(user.tier)  # Need to pass user to create()
count = await self.count_user_items(db, user_id)
if count >= limits.max_bookmarks:
    raise ItemLimitExceededError(
        f"Bookmark limit reached ({limits.max_bookmarks}). "
        "Delete some bookmarks or upgrade your plan."
    )
```

3. **Create exception in `backend/src/services/exceptions.py`:**
```python
class ItemLimitExceededError(Exception):
    """Raised when user has reached their item limit for a content type."""
    pass
```

4. **Handle exception in routers** - return 403 with detail message

**Note:** The `create()` methods will need access to the user object (not just `user_id`) to get the tier. Review current signatures and adjust as needed.

**Testing Strategy:**
- Create items up to limit, verify next create fails with 403
- Verify soft-deleted items don't count toward limit
- Verify error message includes the limit number
- Test each content type (bookmarks, notes, prompts)

**Dependencies:** Milestone 1

**Risk Factors:**
- `create()` method signatures may need to change to accept `User` instead of just `user_id`
- Consider whether to check limit in router vs service (service is cleaner but needs user object)

---

### Milestone 4: Field Length Validation Updates

**Goal:** Update validators to use tier-based limits instead of config settings.

**Success Criteria:**
- Title validation uses `max_title_length` from tier (100 chars for free)
- Content validation uses unified `max_content_length` (100K for all types)
- URL validation added with `max_url_length` (2048)
- Tag name validation added with `max_tag_name_length` (50)
- Argument description validation added with `max_argument_description_length` (500)

**Key Changes:**

1. **Update `backend/src/schemas/validators.py`:**

The challenge here is that Pydantic validators don't have access to the user's tier. Two approaches:

**Option A (Recommended): Use maximum possible limit in validators, enforce tier limit in service**
- Validators use a generous ceiling (e.g., 255 for title)
- Service layer checks tier-specific limit before saving
- Simpler, keeps validation logic in one place

**Option B: Pass limits into schema via context**
- More complex, requires Pydantic validation context
- Tighter validation at schema level

Recommend **Option A** for simplicity. The flow becomes:
1. Pydantic validates against ceiling (catches obviously invalid input)
2. Service validates against tier limit (enforces user-specific limit)

```python
# validators.py - use ceiling values
MAX_TITLE_CEILING = 255  # Safety ceiling, tier limits are lower
MAX_CONTENT_CEILING = 500_000  # Safety ceiling
MAX_URL_CEILING = 8192  # Safety ceiling
MAX_TAG_NAME_CEILING = 100  # Safety ceiling
MAX_ARG_DESC_CEILING = 1000  # Safety ceiling

def validate_title_length(title: str | None) -> str | None:
    if title is not None and len(title) > MAX_TITLE_CEILING:
        raise ValueError(f"Title exceeds maximum length of {MAX_TITLE_CEILING}")
    return title

# Add new validators
def validate_url_length(url: str) -> str:
    if len(str(url)) > MAX_URL_CEILING:
        raise ValueError(f"URL exceeds maximum length of {MAX_URL_CEILING}")
    return url

def validate_tag_name_length(tag: str) -> str:
    if len(tag) > MAX_TAG_NAME_CEILING:
        raise ValueError(f"Tag name exceeds maximum length of {MAX_TAG_NAME_CEILING}")
    return tag

def validate_argument_description_length(desc: str | None) -> str | None:
    if desc is not None and len(desc) > MAX_ARG_DESC_CEILING:
        raise ValueError(f"Argument description exceeds maximum length of {MAX_ARG_DESC_CEILING}")
    return desc
```

2. **Add tier-specific validation in services:**
```python
# In service create/update methods
def _validate_field_limits(self, data: dict, limits: TierLimits) -> None:
    if data.get("title") and len(data["title"]) > limits.max_title_length:
        raise FieldLimitExceededError(
            f"Title exceeds your plan's limit of {limits.max_title_length} characters"
        )
    # Similar for content, etc.
```

3. **Update `PromptArgument` schema** to validate description length

4. **Update bookmark schema** to validate URL length

5. **Update tag validators** to check name length

**Testing Strategy:**
- Test ceiling validation catches extreme values
- Test tier-specific validation in services
- Test each field type (title, content, URL, tag name, arg description)
- Test error messages include the limit

**Dependencies:** Milestone 1

**Risk Factors:**
- Two-layer validation (schema ceiling + service tier limit) adds complexity
- Need to ensure consistent error messages between layers

---

### Milestone 5: Remove Legacy Config Settings

**Goal:** Clean up old config settings that are now replaced by tier limits.

**Success Criteria:**
- Remove from `config.py`: `max_title_length`, `max_content_length`, `max_note_content_length`, `max_prompt_content_length`
- Keep `max_description_length` (not tier-based per discussion)
- Keep `max_prompt_name_length`, `max_argument_name_length` (not tier-based)
- Update any code still referencing old settings
- Update frontend `config.ts` to remove corresponding values

**Key Changes:**

1. **Update `backend/src/core/config.py`:**
   - Remove `max_title_length`
   - Remove `max_content_length`
   - Remove `max_note_content_length`
   - Remove `max_prompt_content_length`

2. **Update `frontend/src/config.ts`:**
   - Remove `maxTitleLength`
   - Remove `maxContentLength`
   - Remove `maxNoteContentLength`
   - Remove `maxPromptContentLength`
   - Frontend will fetch limits from API instead

3. **Search codebase** for any remaining references to these settings

**Testing Strategy:**
- Verify application starts without old settings
- Verify no runtime errors from missing settings

**Dependencies:** Milestones 1-4

**Risk Factors:**
- May miss some references - thorough grep needed

---

### Milestone 6: Frontend Limits Integration

**Goal:** Frontend fetches and uses tier limits, with improved UX for limit violations.

**Success Criteria:**
- Frontend fetches limits from `/users/me/limits` on auth
- Title inputs have `maxLength` attribute (prevents over-typing)
- Character counters shown for title/content fields
- Clear error messages when limits exceeded
- Limits cached and available throughout app

**Key Changes:**

1. **Create limits hook/context:**
```typescript
// hooks/useLimits.ts
export function useLimits() {
  const { data: limits } = useQuery({
    queryKey: ['user-limits'],
    queryFn: () => api.get('/users/me/limits'),
    staleTime: 5 * 60 * 1000, // 5 min cache
  })
  return limits
}
```

2. **Update title inputs:**
   - `InlineEditableTitle` - add `maxLength` prop, pass from limits
   - Add character counter component
   - Show "X/100" as user types

3. **Update content editors:**
   - Pass `maxLength` to `MilkdownEditor` and `CodeMirrorEditor`
   - Show character count in editor toolbar

4. **Update create/edit forms:**
   - Bookmark, Note, Prompt forms use limits for validation
   - Show inline errors before submit when limits exceeded

**Testing Strategy:**
- Test limits are fetched on login
- Test title input stops accepting chars at limit
- Test character counters display correctly
- Test error states when approaching/at limits

**Dependencies:** Milestone 2

**Risk Factors:**
- Need to ensure limits are loaded before forms render
- Handle loading state gracefully

---

### Milestone 7: Database Column Adjustments

**Goal:** Adjust database column sizes to be safety ceilings (not enforcement).

**Success Criteria:**
- Title columns changed to `String(255)` (ceiling, not enforcement)
- Migration handles existing data gracefully
- No data truncation (current max is 500, new ceiling is 255, so must verify no titles > 255 exist or handle them)

**Key Changes:**

1. **Check existing data:**
```sql
SELECT MAX(LENGTH(title)) FROM bookmarks;
SELECT MAX(LENGTH(title)) FROM notes;
SELECT MAX(LENGTH(title)) FROM prompts;
```

2. **If any titles > 255 chars exist:**
   - Either keep ceiling at 500
   - Or truncate in migration (with user notification)

3. **Create migration** to alter columns if safe

**Note:** This milestone may be skipped if we decide to keep `String(500)` as the ceiling. The tier limit (100) will be enforced at API layer regardless. The DB column size only matters as a safety net.

**Testing Strategy:**
- Verify migration runs without data loss
- Verify existing items still accessible

**Dependencies:** Milestones 1-4 (enforcement in place first)

**Risk Factors:**
- Data truncation if titles exceed new ceiling
- May decide to skip this milestone entirely

---

## Summary of Changes by File

### Backend

| File | Changes |
|------|---------|
| `core/tier_limits.py` | New file - tier definitions and lookup |
| `models/user.py` | Add `tier` column |
| `schemas/user.py` | Add `UserLimitsResponse` |
| `schemas/validators.py` | Add ceiling validators, tag name length, arg desc length |
| `schemas/bookmark.py` | Add URL length validation |
| `schemas/prompt.py` | Add argument description validation |
| `api/routers/users.py` | Add `/me/limits` endpoint |
| `services/base_entity_service.py` | Add `count_user_items()` method |
| `services/bookmark_service.py` | Add item count check in `create()` |
| `services/note_service.py` | Add item count check in `create()` |
| `services/prompt_service.py` | Add item count check in `create()` |
| `services/exceptions.py` | Add `ItemLimitExceededError`, `FieldLimitExceededError` |
| `core/config.py` | Remove legacy limit settings |

### Frontend

| File | Changes |
|------|---------|
| `hooks/useLimits.ts` | New hook to fetch/cache limits |
| `config.ts` | Remove legacy limit settings |
| `components/InlineEditableTitle.tsx` | Add `maxLength`, character counter |
| `components/InlineEditableText.tsx` | Already has `maxLength` support |
| `components/MilkdownEditor.tsx` | Add character count display |
| `components/CodeMirrorEditor.tsx` | Add character count display |
| Various forms | Use limits from hook for validation |

### Database

| Migration | Changes |
|-----------|---------|
| Add tier column | `ALTER TABLE users ADD COLUMN tier VARCHAR(50) DEFAULT 'free'` |
| (Optional) Adjust title columns | `ALTER TABLE bookmarks/notes/prompts ALTER COLUMN title TYPE VARCHAR(255)` |

---

## Open Questions

1. **Service method signatures:** Currently `create()` takes `user_id: UUID`. To get tier, we need the full `User` object. Options:
   - Pass `User` object instead of `user_id`
   - Look up user in service (extra DB query)
   - Pass tier as separate parameter

2. **DB column ceiling:** Keep at 500 or reduce to 255? If any existing titles are >255, keeping at 500 is safer.

3. **Description limit:** Currently 1,000 chars via config. Should this also move to tier limits, or stay as global config? (Current plan: keep as global config per discussion)

The implementing agent should ask for clarification on these points before proceeding.
