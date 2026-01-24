# Implementation Plan: Filter Sort Fallback

**Date:** 2026-01-23
**Status:** Draft

## Overview

When API consumers (mobile apps, MCP tools) pass a `filter_id` without explicit `sort_by`/`sort_order` parameters, the API should use the filter's stored `default_sort_by` and `default_sort_ascending` values instead of the global defaults (`created_at desc`).

Currently, the frontend works around this by resolving filter sort defaults locally and sending them explicitly. This fix brings the same behavior to the backend for API consumers who can't or don't want to duplicate that logic.

## Problem

**Current behavior:**
- API endpoint has `sort_by="created_at"` and `sort_order="desc"` as parameter defaults
- When `filter_id` is provided, only `filter_expression` is extracted
- Filter's `default_sort_by` and `default_sort_ascending` are ignored
- API consumers get wrong sort order unless they explicitly pass sort params

**Affected endpoints:**
- `GET /bookmarks/` (bookmarks.py:128)
- `GET /notes/` (notes.py:61)
- `GET /prompts/` (prompts.py:176)
- `GET /content/` (content.py:22)

## Solution

1. Make `sort_by` and `sort_order` truly optional (default to `None`)
2. When `filter_id` is provided, use the filter's `default_sort_by`/`default_sort_ascending` as the sort settings
3. If `sort_by` and/or `sort_order` are explicitly provided, they override the filter's sort settings (allows API callers to use a filter's tag expression but with custom sorting)
4. When no filter and no explicit params, use global defaults (`created_at desc`)
5. Extract this logic into a reusable helper to eliminate duplication

---

## Milestone 1: Backend - Reusable Filter Sort Resolution

### Goal
Create a helper function to resolve filter sorting and apply it to all 4 list endpoints.

### Success Criteria
- `sort_by` and `sort_order` are optional (`None` by default) on all list endpoints
- When `filter_id` provided without sort params, uses filter's `default_sort_by`/`default_sort_ascending`
- When explicit sort params provided with `filter_id`, explicit params win
- When no filter and no sort params, falls back to `created_at desc`
- Existing behavior unchanged for callers who pass explicit sort params
- Duplicated filter loading code removed from all 4 routers

### Key Changes

**1. Create helper function (`backend/src/api/filter_utils.py`):**

```python
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from services import content_filter_service


@dataclass
class ResolvedFilter:
    """Result of resolving a filter_id with sort parameters."""

    filter_expression: dict | None
    sort_by: str
    sort_order: Literal["asc", "desc"]
    content_types: list[str] | None  # Only used by content router


async def resolve_filter_and_sorting(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID | None,
    sort_by: str | None,
    sort_order: Literal["asc", "desc"] | None,
) -> ResolvedFilter:
    """
    Resolve filter expression and sorting.

    When filter_id is provided:
      - Uses filter's default_sort_by if sort_by param not provided
      - Uses filter's default_sort_ascending if sort_order param not provided
      - Explicit sort_by/sort_order params override filter settings

    When filter_id is not provided:
      - Uses explicit params if given, otherwise global defaults (created_at desc)

    Args:
        db: Database session
        user_id: Current user's ID
        filter_id: Optional filter UUID
        sort_by: Optional explicit sort field (overrides filter default)
        sort_order: Optional explicit sort direction (overrides filter default)

    Returns:
        ResolvedFilter with filter_expression, sort_by, sort_order, content_types

    Raises:
        HTTPException 404 if filter_id provided but not found
    """
    filter_expression = None
    content_types = None

    if filter_id is not None:
        content_filter = await content_filter_service.get_filter(db, user_id, filter_id)
        if content_filter is None:
            raise HTTPException(status_code=404, detail="Filter not found")

        filter_expression = content_filter.filter_expression
        content_types = content_filter.content_types

        # Use filter's sort defaults if not explicitly provided
        if sort_by is None and content_filter.default_sort_by:
            sort_by = content_filter.default_sort_by
        if sort_order is None and content_filter.default_sort_ascending is not None:
            sort_order = "asc" if content_filter.default_sort_ascending else "desc"

    # Global fallbacks
    return ResolvedFilter(
        filter_expression=filter_expression,
        sort_by=sort_by or "created_at",
        sort_order=sort_order or "desc",
        content_types=content_types,
    )
```

**2. Update endpoint signatures (all 4 routers):**

Change from:
```python
sort_by: Literal[...] = Query(default="created_at", ...)
sort_order: Literal["asc", "desc"] = Query(default="desc", ...)
```

To:
```python
sort_by: Literal[...] | None = Query(default=None, ...)
sort_order: Literal["asc", "desc"] | None = Query(default=None, ...)
```

**3. Update endpoint implementations:**

Replace duplicated filter loading code with helper call:

```python
# Before (repeated in each router):
filter_expression = None
if filter_id is not None:
    content_filter = await content_filter_service.get_filter(db, current_user.id, filter_id)
    if content_filter is None:
        raise HTTPException(status_code=404, detail="Filter not found")
    filter_expression = content_filter.filter_expression

# After (bookmarks, notes, prompts routers):
from api.filter_utils import resolve_filter_and_sorting

resolved = await resolve_filter_and_sorting(db, current_user.id, filter_id, sort_by, sort_order)
# Use resolved.filter_expression, resolved.sort_by, resolved.sort_order
# Ignore resolved.content_types (only used by content router)
```

**4. Content router uses the same helper:**

The content router also needs `content_types`, which is included in the `ResolvedFilter` dataclass:

```python
# content router - uses all fields including content_types
resolved = await resolve_filter_and_sorting(db, current_user.id, filter_id, sort_by, sort_order)

# Handle content_types intersection with query param (existing logic)
# Note: `content_types` below refers to the query parameter from the endpoint signature
if content_types is None:
    effective_content_types = resolved.content_types
else:
    effective_content_types = [
        ct for ct in content_types  # content_types = query param
        if resolved.content_types is None or ct in resolved.content_types
    ]
```

### Testing Strategy

**New test file: `backend/tests/api/test_filter_sort_fallback.py`**

Tests should cover all 4 endpoints. Use parametrization where the test logic is identical.

**Core behavior tests (parametrized across endpoints):**

| Test | Behavior |
|------|----------|
| `test__list__filter_id_uses_filter_sort_defaults` | Create filter with `default_sort_by="title"`, `default_sort_ascending=True`. Call with only `filter_id`. Verify items returned in title ascending order. |
| `test__list__explicit_sort_overrides_filter_defaults` | Create filter with `default_sort_by="title"`, `default_sort_ascending=True`. Call with `filter_id` and `sort_by=created_at&sort_order=desc`. Verify explicit params win. |
| `test__list__partial_override_sort_by_only` | Create filter with both sort defaults. Call with only `sort_by=updated_at`. Verify `sort_by` is overridden but `sort_order` falls back to filter default. |
| `test__list__partial_override_sort_order_only` | Create filter with both sort defaults. Call with only `sort_order=desc`. Verify `sort_order` is overridden but `sort_by` falls back to filter default. |
| `test__list__filter_without_sort_defaults_uses_global_fallback` | Create filter without `default_sort_by`. Call with only `filter_id`. Verify falls back to `created_at desc`. |
| `test__list__no_filter_no_sort_uses_global_defaults` | Call endpoint with no `filter_id`, no `sort_by`, no `sort_order`. Verify `created_at desc`. |

**Edge cases:**

| Test | Behavior |
|------|----------|
| `test__list__filter_has_sort_by_but_null_ascending` | Filter has `default_sort_by="title"` but `default_sort_ascending=None`. Verify `sort_by` from filter, `sort_order` falls back to `"desc"`. |
| `test__list__filter_has_ascending_but_null_sort_by` | Filter has `default_sort_ascending=True` but `default_sort_by=None`. Verify falls back to `created_at asc` (ascending from filter, field from global). |

**Helper function unit tests (`backend/tests/api/test_filter_utils.py`):**

| Test | Behavior |
|------|----------|
| `test__resolve_filter_and_sorting__no_filter_no_params__returns_global_defaults` | Returns ResolvedFilter with `None`, `"created_at"`, `"desc"`, `None` |
| `test__resolve_filter_and_sorting__no_filter__content_types_is_none` | When no filter_id, content_types is None |
| `test__resolve_filter_and_sorting__filter_with_sort_defaults__uses_filter_values` | Returns filter's sort settings and content_types |
| `test__resolve_filter_and_sorting__explicit_params_override_filter` | Explicit params take priority over filter defaults |
| `test__resolve_filter_and_sorting__partial_override_sort_by` | Only `sort_by` overridden, `sort_order` from filter |
| `test__resolve_filter_and_sorting__partial_override_sort_order` | Only `sort_order` overridden, `sort_by` from filter |
| `test__resolve_filter_and_sorting__filter_not_found__raises_404` | HTTPException with 404 status |
| `test__resolve_filter_and_sorting__filter_no_sort_defaults__uses_global` | Filter exists but has null sort fields, uses global defaults |

### Dependencies
None.

### Risk Factors
- Need to verify OpenAPI schema still documents the sort options correctly (since they're now optional with None default)

---

## Implementation Notes

### Backwards Compatibility

This change is backwards compatible:
- Callers who pass explicit `sort_by`/`sort_order` get identical behavior
- Only callers who pass `filter_id` without sort params see changed behavior (they get the filter's defaults instead of global defaults)

### Frontend Impact

None. The frontend already resolves filter defaults locally and sends explicit sort params. This fix brings parity for API consumers.

### MCP Server Impact

MCP tools that use `filter_id` will now get correct sort order automatically. This is the primary use case for this fix.

### OpenAPI Documentation

The endpoint parameters will show `sort_by` and `sort_order` as optional (nullable) with no default value. The description should clarify the fallback behavior:

```python
sort_by: Literal[...] | None = Query(
    default=None,
    description="Sort field. If not provided, uses filter's default_sort_by (when filter_id given) or 'created_at'.",
)
sort_order: Literal["asc", "desc"] | None = Query(
    default=None,
    description="Sort direction. If not provided, uses filter's default_sort_ascending (when filter_id given) or 'desc'.",
)
```

### Filter Sort Field Validation

No additional validation needed. Filters can only store `default_sort_by` values from `FilterSortByOption = Literal["created_at", "updated_at", "last_used_at", "title"]` (defined in `schemas/content_filter.py`). All 4 list endpoints accept these fields, so a filter's sort defaults are always valid across all endpoints. The schema explicitly excludes `archived_at` and `deleted_at` from filter defaults.
