# Implementation Plan: Multi-Tab Change Detection

**Date:** 2026-01-22
**Status:** Draft

## Overview

Implement change detection to prevent data loss when the same note is open in multiple browser tabs/windows or devices. Currently, if a user edits a note in Tab A, saves, then edits and saves from Tab B (which has stale data), the changes from Tab A are silently overwritten.

## Solution Approach

Combine two complementary strategies:

1. **Stale Check on Tab Focus (Frontend)** - When a tab gains focus, check if the note was modified elsewhere and warn the user before they start editing stale data.

2. **Optimistic Locking on Save (Backend)** - When saving, verify the note hasn't been modified since it was loaded. If it has, return 409 Conflict instead of silently overwriting.

This approach:
- Catches 90%+ of real-world scenarios (user switches between tabs)
- Provides a hard safety net for edge cases
- Requires no real-time infrastructure (WebSockets, etc.)
- Leverages existing `updated_at` timestamp (no schema changes needed)

## Scope

**In Scope:**
- Notes, bookmarks, and prompts (all editable entity types)
- Multi-tab detection within same browser and across devices
- 409 Conflict response with server state
- Conflict resolution UI with clear options
- Reusable logic across entity types (backend and frontend)

**Out of Scope:**
- Automatic merge/diff (complex, overkill for personal app)
- Real-time collaboration features (would require WebSockets)

---

## Milestone 0: Test Infrastructure Refactor

### Goal
Refactor duplicated tests across entity types (notes, bookmarks, prompts) into shared parametrized test suites. This establishes the pattern we'll use for optimistic locking tests and reduces maintenance burden.

### Background

Current test state:
- 404 tests across 3 entity types (~9,000 lines)
- ~50% duplication - identical test logic repeated for each entity type
- Adding new cross-entity features (like optimistic locking) requires writing 3x the tests

### Success Criteria
- Tier 1 patterns refactored into parametrized tests
- Tests still pass with same coverage
- Clear pattern established for future cross-entity tests
- Tier 2 feasibility assessment documented

### Tier 1 Refactoring (100% Identical Logic)

These patterns have identical logic across all three entity types and can be directly parametrized:

| Pattern | Current Tests | After Refactor | Lines Saved |
|---------|---------------|----------------|-------------|
| Archive/Unarchive | 18 | 6 | ~120 |
| Soft Delete & Restore | 21 | 7 | ~140 |
| Track Usage | 12 | 4 | ~80 |
| List Views (active/archived/deleted) | 9 | 3 | ~60 |
| Get Operations (404, archived access) | 6 | 2 | ~40 |
| **Total** | **66** | **22** | **~440** |

#### IDOR Tests Decision

**IDOR tests (cross-user isolation) are intentionally NOT parametrized.** These tests remain inline in each entity's test file.

**Rationale:** IDOR tests require creating a second user with PAT authentication and switching from dev-mode to non-dev mode. This involves modifying global `app.dependency_overrides` which creates fixture ordering conflicts:

1. `entity_setup` fixture creates entity using dev-mode `client`
2. `client_other_user` fixture modifies app to non-dev mode for PAT auth
3. Pytest doesn't guarantee ordering between independent fixtures at the same level
4. When `client_other_user` runs first, entity creation fails with 401

The existing inline approach (create entity → create user2 inline → test isolation) avoids this issue. Parametrizing would add complexity without improving maintainability.

### Implementation Approach

**1. Create shared test infrastructure (`backend/tests/api/conftest.py` additions):**

```python
import pytest

@pytest.fixture
async def note_entity(client):
    """Create a note via API and return test context."""
    response = await client.post("/notes/", json={
        "title": "Test Note",
        "content": "Test content",
    })
    assert response.status_code == 201
    data = response.json()
    return {
        "id": data["id"],
        "entity": data,
        "base_endpoint": "/notes",
        "endpoint": f"/notes/{data['id']}",
        "entity_type": "note",
        "entity_name": "Note",
    }

@pytest.fixture
async def bookmark_entity(client):
    """Create a bookmark via API and return test context."""
    response = await client.post("/bookmarks/", json={
        "url": "https://example.com",
        "title": "Test Bookmark",
    })
    assert response.status_code == 201
    data = response.json()
    return {
        "id": data["id"],
        "entity": data,
        "base_endpoint": "/bookmarks",
        "endpoint": f"/bookmarks/{data['id']}",
        "entity_type": "bookmark",
        "entity_name": "Bookmark",
    }

@pytest.fixture
async def prompt_entity(client):
    """Create a prompt via API and return test context."""
    response = await client.post("/prompts/", json={
        "name": "test-prompt",
        "content": "Hello {{ name }}",
        "arguments": [{"name": "name", "description": "Name to greet", "required": True}],
    })
    assert response.status_code == 201
    data = response.json()
    return {
        "id": data["id"],
        "entity": data,
        "base_endpoint": "/prompts",
        "endpoint": f"/prompts/{data['id']}",
        "entity_type": "prompt",
        "entity_name": "Prompt",
    }

```

**2. Create new shared test file (`backend/tests/api/test_entity_common.py`):**

```python
import pytest

ENTITY_FIXTURES = ["note_entity", "bookmark_entity", "prompt_entity"]


@pytest.mark.parametrize("entity_fixture", ENTITY_FIXTURES)
class TestArchiveUnarchive:
    """Archive/unarchive tests for all entity types."""

    async def test__archive__success(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        response = await client.post(f"{setup['endpoint']}/archive")
        assert response.status_code == 200
        assert response.json()["archived_at"] is not None

    async def test__archive__already_archived_is_idempotent(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.post(f"{setup['endpoint']}/archive")
        response = await client.post(f"{setup['endpoint']}/archive")
        assert response.status_code == 200

    async def test__archive__not_found_returns_404(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.post(f"{setup['base_endpoint']}/{fake_id}/archive")
        assert response.status_code == 404

    async def test__unarchive__success(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.post(f"{setup['endpoint']}/archive")
        response = await client.post(f"{setup['endpoint']}/unarchive")
        assert response.status_code == 200
        assert response.json()["archived_at"] is None

    async def test__unarchive__not_archived_returns_400(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        response = await client.post(f"{setup['endpoint']}/unarchive")
        assert response.status_code == 400

    async def test__unarchive__not_found_returns_404(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.post(f"{setup['base_endpoint']}/{fake_id}/unarchive")
        assert response.status_code == 404


@pytest.mark.parametrize("entity_fixture", ENTITY_FIXTURES)
class TestSoftDeleteRestore:
    """Soft delete and restore tests for all entity types."""

    async def test__delete__soft_delete_success(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        response = await client.delete(setup['endpoint'])
        assert response.status_code == 204

    async def test__delete__soft_deleted_not_in_active_list(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.delete(setup['endpoint'])
        response = await client.get(setup['base_endpoint'])
        ids = [item["id"] for item in response.json()["items"]]
        assert setup['id'] not in ids

    async def test__delete__soft_deleted_in_deleted_view(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.delete(setup['endpoint'])
        response = await client.get(f"{setup['base_endpoint']}?view=deleted")
        ids = [item["id"] for item in response.json()["items"]]
        assert setup['id'] in ids

    async def test__restore__success(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.delete(setup['endpoint'])
        response = await client.post(f"{setup['endpoint']}/restore")
        assert response.status_code == 200
        assert response.json()["deleted_at"] is None

    async def test__restore__not_deleted_returns_400(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        response = await client.post(f"{setup['endpoint']}/restore")
        assert response.status_code == 400

    async def test__delete__permanent_removes_from_db(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.delete(setup['endpoint'])  # Soft delete first
        response = await client.delete(f"{setup['endpoint']}?permanent=true")
        assert response.status_code == 204
        # Verify gone from deleted view too
        response = await client.get(f"{setup['base_endpoint']}?view=deleted")
        ids = [item["id"] for item in response.json()["items"]]
        assert setup['id'] not in ids


@pytest.mark.parametrize("entity_fixture", ENTITY_FIXTURES)
class TestTrackUsage:
    """Track usage tests for all entity types."""

    async def test__track_usage__updates_last_used_at(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        original_last_used = setup['entity']['last_used_at']
        response = await client.post(f"{setup['endpoint']}/track-usage")
        assert response.status_code == 204
        # Verify timestamp updated
        get_response = await client.get(setup['endpoint'])
        assert get_response.json()["last_used_at"] > original_last_used

    async def test__track_usage__works_on_archived(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.post(f"{setup['endpoint']}/archive")
        response = await client.post(f"{setup['endpoint']}/track-usage")
        assert response.status_code == 204

    async def test__track_usage__works_on_deleted(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.delete(setup['endpoint'])
        response = await client.post(f"{setup['endpoint']}/track-usage")
        assert response.status_code == 204

    async def test__track_usage__not_found_returns_404(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.post(f"{setup['base_endpoint']}/{fake_id}/track-usage")
        assert response.status_code == 404


@pytest.mark.parametrize("entity_fixture", ENTITY_FIXTURES)
class TestListViews:
    """List view filtering tests for all entity types."""

    async def test__list__active_view_excludes_archived(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.post(f"{setup['endpoint']}/archive")
        response = await client.get(setup['base_endpoint'])  # default view=active
        ids = [item["id"] for item in response.json()["items"]]
        assert setup['id'] not in ids

    async def test__list__archived_view_shows_only_archived(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.post(f"{setup['endpoint']}/archive")
        response = await client.get(f"{setup['base_endpoint']}?view=archived")
        ids = [item["id"] for item in response.json()["items"]]
        assert setup['id'] in ids

    async def test__list__deleted_view_shows_only_deleted(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.delete(setup['endpoint'])
        response = await client.get(f"{setup['base_endpoint']}?view=deleted")
        ids = [item["id"] for item in response.json()["items"]]
        assert setup['id'] in ids


@pytest.mark.parametrize("entity_fixture", ENTITY_FIXTURES)
class TestGetOperations:
    """Get single entity tests for all entity types."""

    async def test__get__not_found_returns_404(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        fake_id = "00000000-0000-0000-0000-000000000000"
        response = await client.get(f"{setup['base_endpoint']}/{fake_id}")
        assert response.status_code == 404

    async def test__get__can_access_archived(self, request, client, entity_fixture):
        setup = request.getfixturevalue(entity_fixture)
        await client.post(f"{setup['endpoint']}/archive")
        response = await client.get(setup['endpoint'])
        assert response.status_code == 200


```

**3. Remove duplicated tests from individual test files:**

After creating the shared tests, remove the equivalent tests from:
- `backend/tests/api/test_notes.py`
- `backend/tests/api/test_bookmarks.py`
- `backend/tests/api/test_prompts.py`

Keep entity-specific tests (e.g., bookmark URL validation, prompt template validation, note title requirements).

### Tier 2 Feasibility Assessment (Completed)

After analyzing the Tier 2 patterns, here are the findings and recommendations:

| Pattern | Current Tests | Recommendation | Rationale |
|---------|---------------|----------------|-----------|
| Within-Content Search | 33 | **Do Not Parametrize** | Significant entity differences (see below) |
| Partial Read (line-based) | ~18 | **Consider Later** | Similar but entity setup is complex |
| String Replace | 57 | **Do Not Parametrize** | Prompts have Jinja2 validation, too different |
| Tag Filtering | ~12 | **Already in list tests** | Embedded in list endpoint tests |

#### Within-Content Search Analysis (33 tests)
- **Notes:** 13 tests - has `description` field, tests case sensitivity options, context lines
- **Bookmarks:** 10 tests - has `url` field, different searchable fields
- **Prompts:** 10 tests - has Jinja template testing, different field set

**Blockers:**
1. Different searchable fields per entity type (`description` vs `url` vs `name`)
2. Notes test context lines feature that may not exist for others
3. Each entity has ~3-4 entity-specific test scenarios
4. Overlap is only ~5-6 generic tests (basic, no_matches, not_found, invalid_field, works_on_archived, works_on_deleted)

**Verdict:** Only 5-6 tests could be parametrized. The effort-to-benefit ratio is poor for such a small reduction.

#### String Replace Analysis (57 tests)
- **Notes:** 14 tests - basic str-replace tests
- **Bookmarks:** 14 tests - basic str-replace tests
- **Prompts:** 29 tests - all notes/bookmark tests PLUS 15 Jinja2 template validation tests

**Blockers:**
1. Prompts have 15 additional tests for template validation (`jinja_valid_template`, `jinja_invalid_syntax`, `jinja_undefined_variable`, argument updates, etc.)
2. Prompts require different fixture setup (needs valid template with arguments)
3. Even the "identical" tests have subtle differences in response validation

**Verdict:** Parametrizing would require complex conditional logic. Keep separate.

#### Partial Read Analysis (~18 tests)
- All three entity types support line-based partial reads
- Tests are structurally similar: `start_line`, `end_line`, `start_line_exceeds_total`, etc.
- Content setup varies: notes/bookmarks just need content, prompts need valid templates

**Verdict:** Could be parametrized in a future pass, but low priority. The tests are not heavily duplicated and each entity type has 4-6 partial read tests.

#### Tag Filtering Analysis (~12 tests)
Most tag filtering tests are embedded in the list endpoint tests rather than standalone. The existing `test__list_prompts__tag_filter`, `test_tag_filter_single_tag`, etc. are testing list behavior with filters applied. These are entity-specific list tests, not generic tag operations.

**Verdict:** Already appropriately organized. No action needed.

### Summary

**Tier 1 delivered:** 66 tests → 22 parametrized = 440 lines saved, clear pattern established.

**Tier 2 recommendation:** Do not proceed with parametrization. The entity-specific variations make the effort-to-benefit ratio poor:
- Within-content search: Only 5-6 generic tests overlap
- String replace: Prompts are fundamentally different due to Jinja2 validation
- Partial read: Could be done but low priority (small test count)
- Tag filtering: Already appropriately organized

The test infrastructure from Tier 1 (`test_entity_common.py`) is ready for future cross-entity tests like optimistic locking (Milestone 1).

### Testing the Refactor

1. Run full test suite before refactoring to establish baseline
2. After each class migration, run tests to verify no regressions
3. Compare coverage reports before/after to ensure no coverage loss

### Dependencies
None - this is the foundation milestone.

### Risk Factors
- Some tests may have subtle entity-specific assertions that need preservation
- Prompt fixtures need valid Jinja2 content (must include `arguments` for template variables)

---

## Milestone 1: Backend - Optimistic Locking

### Goal
Add version checking to update endpoints for notes, bookmarks, and prompts to prevent silent overwrites. Implement as reusable logic in the base service.

### Success Criteria
- PATCH endpoints for `/notes/{id}`, `/bookmarks/{id}`, and `/prompts/{id}` accept optional `expected_updated_at` parameter
- Returns 409 Conflict if entity was modified after `expected_updated_at`
- 409 response includes current server state for conflict resolution
- Existing clients without `expected_updated_at` continue to work (backwards compatible)
- Logic is reusable across all entity types

### Key Changes

**1. Update schema base or individual schemas:**

Add optional `expected_updated_at` field to `NoteUpdate`, `BookmarkUpdate`, and `PromptUpdate`:

```python
# Could create a mixin or add to each schema
expected_updated_at: datetime | None = Field(
    default=None,
    description="For optimistic locking. If provided and entity was modified after "
                "this timestamp, returns 409 Conflict with current server state.",
)
```

**2. Add conflict check helper (reusable across routers):**

Create a helper function that can be used by all entity routers:

```python
# backend/src/api/helpers/conflict_check.py
async def check_optimistic_lock(
    db: AsyncSession,
    service: BaseEntityService,
    user_id: UUID,
    entity_id: UUID,
    expected_updated_at: datetime | None,
    response_schema: type[BaseModel],
) -> None:
    """
    Check for conflicts before update. Raises HTTPException 409 if stale.
    Call this at the start of update endpoints when expected_updated_at is provided.

    409 response structure (nested under "detail"):
    {
        "error": "conflict",
        "message": "This item was modified since you loaded it",
        "server_state": { ... full entity ... }
    }
    """
    if expected_updated_at is None:
        return  # No optimistic locking requested

    current_updated_at = await service.get_updated_at(db, user_id, entity_id)
    if current_updated_at is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    if current_updated_at > expected_updated_at:
        # Note: include_archived=True to match update endpoint behavior
        current_entity = await service.get(db, user_id, entity_id, include_archived=True)
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "This item was modified since you loaded it",
                "server_state": response_schema.model_validate(current_entity).model_dump(),
            },
        )
```

**3. Update each router to use the helper:**

```python
# In notes.py, bookmarks.py, prompts.py
@router.patch("/{entity_id}", response_model=EntityResponse)
async def update_entity(entity_id: UUID, data: EntityUpdate, ...) -> EntityResponse:
    # Check for conflicts BEFORE applying update
    await check_optimistic_lock(
        db, entity_service, current_user.id, entity_id,
        data.expected_updated_at, EntityResponse,
    )
    # IMPORTANT: Exclude expected_updated_at before passing to service
    # It's not a model field and would pollute the ORM object
    update_data = data.model_dump(exclude_unset=True, exclude={"expected_updated_at"})
    entity = await entity_service.update(db, current_user.id, entity_id, update_data)
    # ...
```

**4. Add to str-replace endpoints:**

For consistency, str-replace endpoints should also support optimistic locking:

```python
# Add to StrReplaceRequest schema
class StrReplaceRequest(BaseModel):
    old_str: str
    new_str: str
    expected_updated_at: datetime | None = Field(
        default=None,
        description="For optimistic locking. If provided and entity was modified after "
                    "this timestamp, returns 409 Conflict.",
    )

# In str-replace endpoint
@router.patch("/{entity_id}/str-replace")
async def str_replace_entity(entity_id: UUID, data: StrReplaceRequest, ...):
    await check_optimistic_lock(
        db, entity_service, current_user.id, entity_id,
        data.expected_updated_at, EntityResponse,
    )
    # Proceed with str-replace...
```

This maintains backwards compatibility (field is optional) while allowing MCP clients to opt-in to conflict detection.

### Testing Strategy

**Use `pytest.parametrize` to run identical test logic against all three entity types.** This reduces duplication and ensures consistent behavior.

**Test file: `backend/tests/api/test_optimistic_locking.py`**

Reuses the `note_entity`, `bookmark_entity`, `prompt_entity` fixtures from `conftest.py` (created in Milestone 0).

```python
import pytest

ENTITY_FIXTURES = ["note_entity", "bookmark_entity", "prompt_entity"]


@pytest.mark.parametrize("entity_fixture", ENTITY_FIXTURES)
class TestOptimisticLocking:
    """Optimistic locking tests run against all entity types."""

    async def test__update__with_expected_updated_at__success(self, request, client, entity_fixture):
        """Update succeeds when timestamps match exactly."""
        setup = request.getfixturevalue(entity_fixture)
        response = await client.patch(
            setup['endpoint'],
            json={
                "title": "Updated Title",
                "expected_updated_at": setup['entity']['updated_at'],
            },
        )
        assert response.status_code == 200

    async def test__update__with_expected_updated_at__conflict_returns_409(self, request, client, entity_fixture):
        """Returns 409 when entity was modified after expected time."""
        setup = request.getfixturevalue(entity_fixture)
        stale_timestamp = setup['entity']['updated_at']

        # Modify the entity to change its updated_at
        await client.patch(setup['endpoint'], json={"title": "First Update"})

        # Try to update with stale timestamp
        response = await client.patch(
            setup['endpoint'],
            json={
                "title": "Second Update",
                "expected_updated_at": stale_timestamp,
            },
        )
        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "conflict"
        assert "server_state" in response.json()["detail"]
```

**Parametrized tests (each runs 3x, once per entity type):**

*Happy path:*
1. `test__update__with_expected_updated_at__success` - Update succeeds when timestamps match exactly
2. `test__update__with_expected_updated_at__success_when_not_modified` - Update succeeds when entity unchanged since expected time

*Conflict detection:*
3. `test__update__with_expected_updated_at__conflict_returns_409` - Returns 409 when entity was modified after expected time
4. `test__update__conflict_response_includes_server_state` - 409 response contains full current entity state
5. `test__update__conflict_response_structure` - Verify error format: `{error: "conflict", message: "...", server_state: {...}}`

*Backwards compatibility:*
6. `test__update__without_expected_updated_at__allows_update` - Existing behavior unchanged (last-write-wins)
7. `test__update__without_expected_updated_at__no_conflict_check` - No 409 even if entity was modified

*Edge cases:*
8. `test__update__expected_updated_at__entity_not_found_returns_404` - 404 if entity doesn't exist (not 409)
9. `test__update__expected_updated_at__archived_entity` - Works correctly with archived entities
10. `test__update__expected_updated_at__timezone_handling` - UTC timestamps compared correctly regardless of input timezone

**Helper tests (`backend/tests/api/test_conflict_check.py`):**

1. `test__check_optimistic_lock__returns_none_when_no_expected_updated_at` - No-op when not requested
2. `test__check_optimistic_lock__raises_409_when_stale` - Raises HTTPException with correct structure
3. `test__check_optimistic_lock__raises_404_when_entity_not_found` - 404 before 409 check

### Dependencies
None - this is the foundation milestone.

### Risk Factors
- Need to handle timezone edge cases (ensure consistent UTC comparison)
- The `get_updated_at` query adds a DB round-trip; acceptable for the safety it provides

---

## Milestone 2: Frontend - Stale Check on Tab Focus

### Goal
Detect when an entity (note, bookmark, or prompt) was modified elsewhere and warn the user before they edit stale data. Implement as a reusable hook that works with any entity type.

### Success Criteria
- When tab gains focus, fetch entity's `updated_at` from server
- **Check is silent and non-blocking**: no loading spinners, no page refresh, no visible delay
- **User sees nothing unless entity is stale**: only if `updated_at` differs do we show the dialog
- **Errors are silently ignored**: network failures don't interrupt the user or show error messages
- Dialog offers clear options with consistent terminology (shared with Milestone 3)
- If user has unsaved changes AND entity is stale, show enhanced warning

### Key Changes

**1. Create generic `useStaleCheck` hook (`frontend/src/hooks/useStaleCheck.ts`):**

Works with any entity type by accepting a fetch function:

```typescript
interface UseStaleCheckOptions {
  entityId: string | undefined
  loadedUpdatedAt: string | undefined
  isDirty: boolean
  // Function to fetch current updated_at from server (uses metadata endpoint)
  fetchUpdatedAt: (id: string) => Promise<string>
}

interface UseStaleCheckResult {
  isStale: boolean
  serverUpdatedAt: string | null  // The server's updated_at if stale, for display
  dismiss: () => void
  refresh: () => Promise<void>
}

export function useStaleCheck({
  entityId,
  loadedUpdatedAt,
  isDirty,
  fetchUpdatedAt,
}: UseStaleCheckOptions): UseStaleCheckResult {
  // On visibilitychange (tab focus), call fetchUpdatedAt silently
  // Compare with loadedUpdatedAt
  // Set isStale only if different (this is the only UI-triggering state)
  // Errors are caught and ignored - don't interrupt user
}
```

**2. Use existing metadata endpoints:**

Each entity type already has a metadata endpoint that returns `updated_at` without loading full content:
- `GET /notes/{id}/metadata`
- `GET /bookmarks/{id}/metadata`
- `GET /prompts/{id}/metadata`

**3. Integrate into detail pages (`NoteDetail.tsx`, `BookmarkDetail.tsx`, `PromptDetail.tsx`):**

```typescript
const { isStale, serverUpdatedAt, dismiss, refresh } = useStaleCheck({
  entityId: entity?.id,
  loadedUpdatedAt: entity?.updated_at,
  isDirty,
  fetchUpdatedAt: (id) => fetchNoteMetadata(id).then(m => m.updated_at),
})

// Show StaleDialog when isStale is true
```

**4. Create `StaleDialog` component (`frontend/src/components/ui/StaleDialog.tsx`):**

Modal dialog that appears when entity is stale (shares base structure with ConflictDialog):

```typescript
interface StaleDialogProps {
  isOpen: boolean
  serverUpdatedAt: string  // For display: "Server version from 5 minutes ago"
  isDirty: boolean         // Whether user has unsaved local changes
  entityType: 'note' | 'bookmark' | 'prompt'
  onLoadServerVersion: () => void  // Fetch and load server version
  onContinueEditing: () => void    // Dismiss dialog, keep local content
}
```

Dialog contents:
- Header: "This {entityType} was modified elsewhere"
- Server modified time: "Server version from 5 minutes ago"
- **"Load Server Version"** button - Calls `onLoadServerVersion`
  - Helper text: "Discard your changes and load the latest version"
- **"Continue Editing"** button - Calls `onContinueEditing`
  - Helper text: "Keep your current content and continue editing"
- If `isDirty`: Warning text "You have unsaved changes that will be lost if you load the server version."

**5. Shared Dialog Infrastructure:**

Both `StaleDialog` (Milestone 2) and `ConflictDialog` (Milestone 3) should share:
- Base modal styling and structure
- Server timestamp display formatting ("5 minutes ago")
- Button styling and helper text pattern
- Future: diff view component when added

Consider creating a base `ChangeDetectionDialog` component or shared utilities.

### Testing Strategy

**Hook tests (`frontend/src/hooks/useStaleCheck.test.ts`):**

*Core functionality:*
1. `test__useStaleCheck__detects_stale_on_visibility_change` - Mock `visibilitychange` event, verify `isStale` becomes true when `updated_at` differs
2. `test__useStaleCheck__not_stale_when_timestamps_match` - `isStale` remains false when server `updated_at` matches loaded value
3. `test__useStaleCheck__provides_server_updated_at_when_stale` - `serverUpdatedAt` is populated for display in dialog

*Skip conditions:*
4. `test__useStaleCheck__no_check_when_no_entityId` - Skip API call for new/unsaved entities
5. `test__useStaleCheck__no_check_when_tab_hidden` - Only check when gaining focus, not losing it
6. `test__useStaleCheck__no_check_when_no_loaded_updated_at` - Skip if entity hasn't loaded yet

*User actions:*
7. `test__useStaleCheck__dismiss_clears_stale_state` - `dismiss()` sets `isStale` to false
8. `test__useStaleCheck__refresh_fetches_new_entity` - `refresh()` fetches fresh data and clears stale state

*Error handling:*
9. `test__useStaleCheck__handles_network_error_silently` - Network failure doesn't set error state or interrupt user
10. `test__useStaleCheck__handles_404_when_entity_deleted` - Entity deleted in other tab shows appropriate state

*Edge cases:*
11. `test__useStaleCheck__debounces_rapid_tab_switches` - Multiple rapid focus events don't trigger multiple API calls

**Component tests (`frontend/src/components/ui/StaleDialog.test.tsx`):**

*Rendering:*
1. `test__StaleDialog__renders_as_modal` - Verify modal structure and overlay
2. `test__StaleDialog__shows_load_and_continue_buttons` - Both action buttons present
3. `test__StaleDialog__shows_server_modified_time` - Displays formatted timestamp ("5 minutes ago")
4. `test__StaleDialog__shows_entity_type_in_header` - "This note was modified elsewhere"

*Conditional content:*
5. `test__StaleDialog__shows_dirty_warning_when_has_unsaved_changes` - Warning text when `isDirty`
6. `test__StaleDialog__no_dirty_warning_when_clean` - No warning when no local changes

*User interactions:*
7. `test__StaleDialog__load_server_version_calls_callback` - Verify callback
8. `test__StaleDialog__continue_editing_calls_callback` - Verify callback

*Accessibility:*
9. `test__StaleDialog__traps_focus` - Focus stays within dialog
10. `test__StaleDialog__escape_key_continues_editing` - Escape dismisses (same as Continue Editing)

### Dependencies
- Milestone 1 (backend changes) - Not strictly required, but should be done together

### Risk Factors
- Frequent tab switching could cause many API calls; consider debouncing
- Need to handle case where entity was deleted in other tab (404 response)

---

## Milestone 3: Frontend - Handle 409 Conflict on Save

### Goal
When the backend returns 409 Conflict, show a conflict resolution dialog instead of a generic error. Works for all entity types with reusable components.

### Success Criteria
- Detect 409 response in mutation error handler
- Show conflict dialog with clear options and copy functionality
- User can copy their content before deciding
- "Save My Version" requires confirmation (same pattern as delete)
- Works for notes, bookmarks, and prompts

### Key Changes

**1. Update types (`frontend/src/types.ts`):**

Add `expected_updated_at` to all update types:

```typescript
interface NoteUpdate {
  // ... existing fields ...
  expected_updated_at?: string  // ISO 8601 timestamp for optimistic locking
}

interface BookmarkUpdate {
  // ... existing fields ...
  expected_updated_at?: string
}

interface PromptUpdate {
  // ... existing fields ...
  expected_updated_at?: string
}
```

**2. Update mutation hooks (`useNoteMutations.ts`, `useBookmarkMutations.ts`, `usePromptMutations.ts`):**

- Include `expected_updated_at` in update payload (from the loaded entity's `updated_at`)
- Handle 409 specially - don't rollback optimistic update, instead trigger conflict dialog

**3. Create `ConflictDialog` component (`frontend/src/components/ui/ConflictDialog.tsx`):**

Modal dialog with clear options:

```typescript
interface ConflictDialogProps {
  isOpen: boolean
  serverUpdatedAt: string  // For display: "Server version from 5 minutes ago"
  currentContent: string   // The user's current editor content (for copy)
  entityType: 'note' | 'bookmark' | 'prompt'
  onLoadServerVersion: () => void  // Fetch and load server version
  onSaveMyVersion: () => void      // Force save without version check
  onDoNothing: () => void          // Close dialog, keep local changes unsaved
}
```

Dialog contents:
- Header: "This {entityType} was modified while you were editing"
- Server modified time: "Server version from 5 minutes ago"
- **"Copy My Content"** button (always visible, top of actions) - Copies `currentContent` to clipboard, shows toast "Content copied"
- **"Load Server Version"** button - Calls `onLoadServerVersion`
  - Helper text: "Discard your changes and load the latest version"
- **"Save My Version"** button - Uses confirm pattern (first click shows "Confirm?", second click executes)
  - Helper text: "Overwrite server changes with your version"
- **"Do Nothing"** button - Calls `onDoNothing`
  - Helper text: "Close this dialog and continue editing (changes remain unsaved)"

**4. Integrate into detail pages:**

Each detail page (Note, Bookmark, Prompt) needs to:
1. Track conflict state
2. Pass current editor content to dialog for copy functionality
3. Handle each action appropriately

```typescript
const [conflictState, setConflictState] = useState<{
  isOpen: boolean
  serverUpdatedAt: string
  serverState: EntityResponse  // Full server state for reload option
} | null>(null)

// In handleSave, catch 409:
try {
  await updateMutation.mutateAsync({ id, data: { ...updates, expected_updated_at: entity.updated_at } })
} catch (error) {
  if (error.response?.status === 409) {
    const detail = error.response.data.detail
    setConflictState({
      isOpen: true,
      serverUpdatedAt: detail.server_state.updated_at,
      serverState: detail.server_state,
    })
    return // Don't show generic error toast
  }
  throw error // Let normal error handling proceed
}

// Dialog handlers:
const handleLoadServerVersion = () => {
  setEntity(conflictState.serverState)  // Replace local with server
  setConflictState(null)
}

const handleSaveMyVersion = async () => {
  // Retry save WITHOUT expected_updated_at (force overwrite)
  await updateMutation.mutateAsync({ id, data: updates })  // No expected_updated_at
  setConflictState(null)
}

const handleDoNothing = () => {
  setConflictState(null)  // Close dialog, keep local changes unsaved
}
```

### Testing Strategy

**Mutation tests (`frontend/src/hooks/useNoteMutations.test.tsx`):**

*Payload structure:*
1. `test__useUpdateNote__includes_expected_updated_at_from_loaded_note` - Verify `expected_updated_at` sent in PATCH payload
2. `test__useUpdateNote__expected_updated_at_matches_note_updated_at` - Timestamp comes from the loaded note's `updated_at`

*409 handling:*
3. `test__useUpdateNote__409_does_not_trigger_optimistic_rollback` - Local state preserved on conflict (unlike other errors)
4. `test__useUpdateNote__409_error_contains_server_state` - Error object includes server's current note state
5. `test__useUpdateNote__non_409_errors_handled_normally` - Other errors (500, network) still show toast/rollback as before

**Component tests (`frontend/src/components/ui/ConflictDialog.test.tsx`):**

*Rendering:*
1. `test__ConflictDialog__renders_when_open` - Dialog appears when `isOpen` is true
2. `test__ConflictDialog__shows_server_modified_time` - Displays "Modified X minutes ago"
3. `test__ConflictDialog__shows_all_three_options` - Reload, Overwrite, Cancel buttons present

*User actions:*
4. `test__ConflictDialog__reload_calls_onReload_and_closes` - Reload button behavior
5. `test__ConflictDialog__do_nothing_closes_without_action` - Do Nothing preserves local state
6. `test__ConflictDialog__overwrite_requires_confirmation` - First click shows confirmation, second click executes
7. `test__ConflictDialog__overwrite_calls_onOverwrite` - Overwrite triggers save without version check
8. `test__ConflictDialog__copy_copies_content_to_clipboard` - Copy button copies currentContent and shows toast

*Accessibility:*
9. `test__ConflictDialog__traps_focus` - Focus stays within dialog
10. `test__ConflictDialog__escape_key_calls_do_nothing` - Keyboard dismissal works

**Integration tests (`frontend/src/pages/NoteDetail.test.tsx` or `frontend/src/components/Note.test.tsx`):**

*End-to-end conflict flow:*
1. `test__NoteDetail__conflict_dialog_appears_on_save_409` - Full flow: edit → save → 409 → dialog shown
2. `test__NoteDetail__reload_replaces_local_state_with_server_state` - After reload, editor shows server content
3. `test__NoteDetail__overwrite_saves_local_changes_successfully` - Force save bypasses version check
4. `test__NoteDetail__do_nothing_preserves_local_edits_in_editor` - User can continue editing after Do Nothing
5. `test__NoteDetail__local_edits_not_lost_during_conflict_resolution` - Editor content intact while dialog open

*StaleDialog → ConflictDialog flow:*
6. `test__NoteDetail__stale_continue_then_save_shows_conflict_dialog` - User dismisses StaleDialog with "Continue Editing", makes edits, saves → gets ConflictDialog (expected behavior)

### Dependencies
- Milestone 1 (backend 409 support)
- Milestone 2 (useful but not required)

### Risk Factors
- Need to preserve user's local edits in memory during conflict resolution
- "Overwrite" option should be clearly labeled as destructive (loses server changes)

---

## Implementation Notes

### Why `updated_at` Instead of a Version Number

The Note model already has a `version` field (currently unused), but using `updated_at` is preferred because:

1. Already exists and is maintained automatically
2. No migration needed
3. More informative in conflict messages ("modified 5 minutes ago" vs "version 7")
4. Works the same way for conflict detection

The `version` field can be used later if we implement version history.

### Backwards Compatibility

The `expected_updated_at` parameter is optional. Existing clients (including MCP tools) that don't send it will continue to work with last-write-wins behavior. Only the frontend will send it.

### Error Message UX

When showing conflict:
- Show when the server version was modified: "Modified 5 minutes ago"
- Don't show a diff (complex, overkill for personal notes)
- Keep it simple: reload or overwrite

### Performance Considerations

- Stale check on tab focus: Uses lightweight `/metadata` endpoint (~100ms)
- Conflict check on save: Single `get_updated_at` query (~10ms) before update
- Both are acceptable overhead for the safety they provide

### Race Condition (TOCTOU) Acceptance

The conflict check uses a "check-then-update" pattern:
1. `SELECT updated_at` to check for conflicts
2. `UPDATE` to apply changes

There's a theoretical race window (milliseconds) where another update could occur between steps 1 and 2. This is acceptable because:
- For a personal note app, two saves within milliseconds is essentially impossible
- An atomic `UPDATE ... WHERE updated_at = ?` approach would require extra logic to distinguish "not found" (404) from "conflict" (409)
- The simplicity of check-then-update outweighs the theoretical race condition

### Tag Edits from List View

Tag-only edits from the list view (AllContent) use **last-write-wins** and do not include `expected_updated_at`. This is acceptable because:
- Tag edits are quick, low-stakes operations
- Less prone to conflicts than content edits
- Passing timestamps through the list view adds complexity for minimal benefit

### StaleDialog → Continue Editing → ConflictDialog Flow

When a user:
1. Sees StaleDialog (tab focus detected stale content)
2. Clicks "Continue Editing" (dismisses dialog)
3. Makes edits
4. Clicks Save

They will see ConflictDialog (409 from backend) because `expected_updated_at` still has the original timestamp. This is **intentional and correct behavior**:
- The user was warned and chose to continue
- The backend provides a safety net
- The user gets another chance to resolve the conflict

This flow should be explicitly tested.

---

## Design Decisions

### Entity Coverage
All three entity types (notes, bookmarks, prompts) will support change detection. Backend and frontend logic should be reusable/generic where possible.

### Dialog Wording and Behavior

There are **two dialog components** with consistent terminology but different purposes:

**1. StaleDialog (on tab focus)** - Proactive warning, appears when tab gains focus and entity was modified elsewhere:
- Header: "This {entityType} was modified elsewhere"
- Shows server's modified time: "Server version from 5 minutes ago"
- **"Load Server Version"** - Fetch server version, replace local content
  - Helper text: "Discard your changes and load the latest version"
- **"Continue Editing"** - Dismiss dialog, keep local content (user can still save later)
  - Helper text: "Keep your current content and continue editing"
- If `isDirty`: Warning "You have unsaved changes that will be lost if you load the server version."

**2. ConflictDialog (on 409 save attempt)** - Reactive dialog, appears when user tries to save but server was modified:
- Header: "This {entityType} was modified while you were editing"
- Shows server's modified time: "Server version from 5 minutes ago"
- **"Copy My Content"** button - Copies current editor content to clipboard (always available, allows user to preserve their work before choosing)
- **"Load Server Version"** - Discard local changes, load server version, close dialog
  - Helper text: "Discard your changes and load the latest version"
- **"Save My Version"** - Force save local changes (overwrites server). **Requires confirmation** using same confirm pattern as delete.
  - Helper text: "Overwrite server changes with your version"
- **"Do Nothing"** - Close dialog, keep local changes in editor (unsaved), user can continue editing
  - Helper text: "Close this dialog and continue editing (changes remain unsaved)"

### Shared Dialog Infrastructure

Both dialogs share:
- Modal structure and overlay styling
- Server timestamp display formatting ("5 minutes ago")
- "Load Server Version" button with identical behavior and helper text
- Button styling patterns
- Future: diff view component when added

Consider creating shared utilities or a base component to ensure consistency.

### What "Save My Version" Does
When user confirms "Save My Version":
1. Retry the save **without** `expected_updated_at` (bypasses conflict check)
2. This overwrites whatever is on the server with local content
3. Server changes are lost - this is clearly communicated in the confirmation

### What "Do Nothing" Does
- Closes the dialog
- Local content remains in editor (unchanged)
- Content is still dirty/unsaved
- User can continue editing or manually save later (which may trigger another 409)

### Server Content in Dialog
Show only timestamps for now ("Server version modified 5 minutes ago"). Diff view can be added later if users request it.
