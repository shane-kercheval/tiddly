# Implementation Plan: Filter-Tag Relationship

**Date:** 2026-01-25

## Overview

When users create or edit filters with tags in the `filter_expression`, those tags should:
1. Appear in the `/tags/` API endpoint
2. Be updated when tags are renamed via Settings -> Tags

Currently, filter expressions store tag names as raw strings in JSONB. This causes two problems:
- Tags defined only in filters don't appear in the tags list
- Renaming a tag via Settings doesn't update filter expressions, breaking the filter

## Problem

**Current behavior:**

1. User creates a filter with `{"groups": [{"tags": ["work"]}]}`
2. No `Tag` record is created - "work" is just a string in JSONB
3. `/tags/` endpoint doesn't show "work" (it only queries the `tags` table)
4. If user later renames "work" to "job" via Settings -> Tags, the filter still contains "work" and matches nothing

**Root cause:**

Filters store tag names as strings with no relationship to `Tag` records. The existing tag system uses junction tables (`bookmark_tags`, `note_tags`, `prompt_tags`) which enable:
- Efficient queries for tag counts
- Cascading operations on tag rename/delete

Filters lack this relationship.

## Solution

Create a `filter_tags` junction table to model the many-to-many relationship between filters and tags. This enables:

1. **Tag visibility** - Tags in filters can be included in `/tags/` response via a simple join
2. **Cascading renames** - When a tag is renamed, we can find and update all filter expressions that reference it
3. **Deletion warnings** - We can warn users if deleting a tag that's used in filters

The junction table is the normalized relational design. A `filter_count` column on `Tag` would be a denormalization that loses information about *which* filters use the tag.

---

## Milestone 1: Database Schema - `filter_tags` Junction Table

### Goal
Create the junction table and model relationship between filters and tags.

### Success Criteria
- `filter_tags` table exists with proper foreign keys and indexes
- `ContentFilter` model has `tag_objects` relationship
- Existing functionality unchanged
- Migration is reversible

### Key Changes

**1. Create `filter_tags` junction table (`models/tag.py`):**

```python
filter_tags = Table(
    "filter_tags",
    Base.metadata,
    Column("filter_id", ForeignKey("content_filters.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_filter_tags_tag_id", "tag_id"),
)
```

**2. Add relationship to `ContentFilter` model:**

```python
# In models/content_filter.py
tag_objects: Mapped[list["Tag"]] = relationship(
    secondary="filter_tags", back_populates="filters"
)
```

**3. Add back-reference to `Tag` model:**

```python
# In models/tag.py
filters: Mapped[list["ContentFilter"]] = relationship(
    secondary="filter_tags", back_populates="tag_objects"
)
```

**4. Create Alembic migration:**

Use `make migration message="add filter_tags junction table"` to generate the migration.

### Testing Strategy
- Migration applies and rolls back cleanly
- Junction table has correct constraints (composite PK, FKs, index)
- CASCADE delete works: deleting a filter removes junction entries
- CASCADE delete works: deleting a tag removes junction entries
- Existing filter CRUD operations unchanged

### Dependencies
None

### Risk Factors
- Ensure import order doesn't cause circular dependency between models

---

## Milestone 2: Sync Junction Table on Filter Create/Update

### Goal
When creating or updating a filter, sync the `filter_tags` junction table with tags in the filter expression.

### Success Criteria
- Creating a filter with tags creates `Tag` records (via existing `get_or_create_tags`)
- Creating a filter populates `filter_tags` junction entries
- Updating a filter's expression syncs junction entries (adds new, removes old)
- Tags from filters appear in `/tags/` endpoint

### Key Changes

**1. Create helper function to extract tags from filter expression:**

```python
# In services/content_filter_service.py
def extract_tags_from_filter_expression(filter_expression: FilterExpression | dict) -> list[str]:
    """Extract all unique tag names from a filter expression."""
    # Handle both FilterExpression model and dict (from DB)
    ...
```

**2. Update `create_filter` in `content_filter_service.py`:**

```python
async def create_filter(...) -> ContentFilter:
    # Extract tags from expression
    tag_names = extract_tags_from_filter_expression(data.filter_expression)

    # Get or create Tag records
    if tag_names:
        tag_objects = await get_or_create_tags(db, user_id, tag_names)
    else:
        tag_objects = []

    content_filter = ContentFilter(...)
    content_filter.tag_objects = tag_objects  # Populate junction table
    ...
```

**3. Update `update_filter` in `content_filter_service.py`:**

```python
async def update_filter(...) -> ContentFilter | None:
    ...
    if data.filter_expression is not None:
        tag_names = extract_tags_from_filter_expression(data.filter_expression)
        if tag_names:
            tag_objects = await get_or_create_tags(db, user_id, tag_names)
        else:
            tag_objects = []
        content_filter.tag_objects = tag_objects  # Syncs junction table
    ...
```

**4. Update `get_user_tags_with_counts` in `tag_service.py`:**

Modify the query to include tags that are in `filter_tags`, even if they have count=0 in content.

```python
async def get_user_tags_with_counts(...) -> list[TagCount]:
    # Subquery for tags used in filters
    filter_tag_subq = (
        select(filter_tags.c.tag_id)
        .where(filter_tags.c.tag_id == Tag.id)
        .correlate(Tag)
        .exists()
    )

    # ... existing count logic ...

    if not include_inactive:
        # Include tags with count > 0 OR tags used in filters
        query = query.having((total_count > 0) | filter_tag_subq)
```

### Testing Strategy

**Service-level tests (`test_content_filter_service.py`):**
- `test__create_filter__creates_tag_records` - Tags in expression create `Tag` records
- `test__create_filter__populates_filter_tags_junction` - Junction entries created
- `test__create_filter__empty_expression_no_tags` - Empty groups don't create tags
- `test__update_filter__adds_new_tags_to_junction` - New tags added
- `test__update_filter__removes_old_tags_from_junction` - Old tags removed (but Tag records remain)
- `test__update_filter__syncs_junction_on_expression_change` - Full sync behavior

**API-level tests (`test_tags.py`):**
- `test__list_tags__includes_tags_from_filters` - Filter-only tags appear in response
- `test__list_tags__filter_tags_have_zero_count` - Filter-only tags have count=0
- `test__list_tags__combines_filter_and_content_tags` - Tag in both has content count only
- `test__list_tags__filter_tag_removed_when_filter_updated` - Tag no longer in any filter excluded (unless has content)

### Dependencies
- Milestone 1 complete

### Risk Factors
- SQLAlchemy relationship assignment behavior - verify it replaces (not appends) junction entries
- Ensure orphaned tags (removed from filter, not used by content) handled correctly

---

## Milestone 3: Cascade Tag Renames to Filter Expressions

### Goal
When a tag is renamed via `/tags/{tag_name}` (PATCH), update the JSONB `filter_expression` in all filters that reference the old tag name.

### Success Criteria
- Renaming a tag updates all filter expressions that reference it
- Filter behavior unchanged after rename (still matches same content)
- Junction table unaffected (references tag by ID, not name)

### Key Changes

**1. Update `rename_tag` in `tag_service.py`:**

```python
async def rename_tag(
    db: AsyncSession,
    user_id: UUID,
    old_name: str,
    new_name: str,
) -> Tag:
    # ... existing validation and rename logic ...

    # Update filter expressions that reference the old name
    await update_filter_expressions_for_renamed_tag(db, user_id, old_normalized, new_normalized)

    # ... rest of existing logic ...
```

**2. Create helper to update filter expressions:**

```python
async def update_filter_expressions_for_renamed_tag(
    db: AsyncSession,
    user_id: UUID,
    old_name: str,
    new_name: str,
) -> None:
    """Update all filter expressions that reference a renamed tag."""
    # Find filters using this tag via junction table
    result = await db.execute(
        select(ContentFilter)
        .join(filter_tags, ContentFilter.id == filter_tags.c.filter_id)
        .join(Tag, filter_tags.c.tag_id == Tag.id)
        .where(
            ContentFilter.user_id == user_id,
            Tag.name == new_name,  # Tag already renamed at this point
        )
    )

    for content_filter in result.scalars():
        # Update JSONB: replace old_name with new_name in all groups
        updated_expression = replace_tag_in_expression(
            content_filter.filter_expression, old_name, new_name
        )
        content_filter.filter_expression = updated_expression
        content_filter.updated_at = func.clock_timestamp()

    await db.flush()


def replace_tag_in_expression(expression: dict, old_name: str, new_name: str) -> dict:
    """Replace a tag name in a filter expression."""
    # Deep copy to avoid mutating original
    result = copy.deepcopy(expression)
    for group in result.get("groups", []):
        if "tags" in group:
            group["tags"] = [
                new_name if tag == old_name else tag
                for tag in group["tags"]
            ]
    return result
```

### Testing Strategy

**Service-level tests (`test_tag_service.py`):**
- `test__rename_tag__updates_filter_expressions` - Filter JSONB updated with new name
- `test__rename_tag__updates_multiple_filters` - All affected filters updated
- `test__rename_tag__updates_filter_updated_at` - Filter timestamp updated
- `test__rename_tag__filter_with_multiple_groups` - All groups in expression updated
- `test__rename_tag__only_affects_users_filters` - Other users' filters unchanged

**API-level tests (`test_tags.py`):**
- `test__rename_tag__filter_still_works_after_rename` - Create filter with tag, rename tag, verify filter still matches content with renamed tag

### Dependencies
- Milestone 2 complete (junction table populated)

### Risk Factors
- JSONB update must preserve other expression fields
- Concurrent modification - consider optimistic locking if filters have `updated_at` checks
- Transaction scope - ensure tag rename and filter updates are atomic

---

## Milestone 4: Handle Tag Deletion with Filters

### Goal
When a tag is deleted, also remove it from filter expressions that reference it.

### Success Criteria
- Deleting a tag removes it from all filter expressions
- Empty groups after tag removal are handled gracefully
- Junction entries cascade automatically (via FK)

### Key Changes

**1. Update `delete_tag` in `tag_service.py`:**

```python
async def delete_tag(
    db: AsyncSession,
    user_id: UUID,
    tag_name: str,
) -> None:
    # ... existing validation ...

    # Update filter expressions to remove the tag
    await remove_tag_from_filter_expressions(db, user_id, normalized)

    # Delete the tag (junction entries cascade automatically)
    await db.delete(tag)
    await db.flush()
```

**2. Create helper to remove tag from filter expressions:**

```python
async def remove_tag_from_filter_expressions(
    db: AsyncSession,
    user_id: UUID,
    tag_name: str,
) -> None:
    """Remove a tag from all filter expressions that reference it."""
    # Find filters using this tag via junction table
    # (Query before deletion since junction will cascade)
    tag = await get_tag_by_name(db, user_id, tag_name)
    if tag is None:
        return

    result = await db.execute(
        select(ContentFilter)
        .join(filter_tags, ContentFilter.id == filter_tags.c.filter_id)
        .where(filter_tags.c.tag_id == tag.id)
    )

    for content_filter in result.scalars():
        updated_expression = remove_tag_from_expression(
            content_filter.filter_expression, tag_name
        )
        content_filter.filter_expression = updated_expression
        content_filter.updated_at = func.clock_timestamp()

    await db.flush()


def remove_tag_from_expression(expression: dict, tag_name: str) -> dict:
    """Remove a tag from a filter expression."""
    result = copy.deepcopy(expression)
    for group in result.get("groups", []):
        if "tags" in group:
            group["tags"] = [tag for tag in group["tags"] if tag != tag_name]
    # Optionally: remove empty groups
    result["groups"] = [g for g in result["groups"] if g.get("tags")]
    return result
```

### Testing Strategy

**Service-level tests (`test_tag_service.py`):**
- `test__delete_tag__removes_from_filter_expressions` - Filter JSONB no longer contains tag
- `test__delete_tag__removes_empty_groups_from_expression` - Groups with no tags removed
- `test__delete_tag__junction_entries_cascade` - `filter_tags` entries removed
- `test__delete_tag__filter_with_multiple_tags_keeps_others` - Other tags in group preserved

**API-level tests (`test_tags.py`):**
- `test__delete_tag__filter_still_valid_after_deletion` - Filter works (matches remaining criteria)

### Dependencies
- Milestone 3 complete

### Risk Factors
- Deleting last tag from a filter's only group leaves an empty filter - is this OK?
- Consider whether to warn users before deleting a tag used in filters (future enhancement)

---

## Milestone 5: Data Migration for Existing Filters

### Goal
Populate the `filter_tags` junction table for any existing filters that have tags in their expressions.

### Success Criteria
- All existing filter tags have corresponding junction entries
- All tags referenced in filters exist in `tags` table
- Migration is idempotent

### Key Changes

**1. Create data migration:**

```python
async def upgrade():
    # For each filter with tags in filter_expression:
    #   1. Extract tag names from expression
    #   2. Get or create Tag records
    #   3. Insert junction entries

    # Query all filters
    filters = await db.execute(select(ContentFilter))

    for content_filter in filters.scalars():
        expression = content_filter.filter_expression
        tag_names = extract_tags_from_filter_expression(expression)

        if not tag_names:
            continue

        # Get or create tags
        tag_objects = await get_or_create_tags(db, content_filter.user_id, tag_names)

        # Insert junction entries (ignore conflicts for idempotency)
        for tag in tag_objects:
            await db.execute(
                filter_tags.insert()
                .values(filter_id=content_filter.id, tag_id=tag.id)
                .on_conflict_do_nothing()
            )

    await db.commit()
```

### Testing Strategy
- Test with no existing filters (no-op)
- Test with filters that have no tags (no-op)
- Test with filters that have tags (junction populated)
- Test idempotency (running twice doesn't duplicate or error)
- Verify tag counts correct after migration

### Dependencies
- Milestone 4 complete (full implementation ready)

### Risk Factors
- Large number of filters may need batching
- Ensure migration runs in transaction for atomicity

---

## Summary

| Milestone | Focus | Risk |
|-----------|-------|------|
| 1 | Junction table schema | Low |
| 2 | Sync on filter create/update | Medium |
| 3 | Cascade tag renames | Medium |
| 4 | Handle tag deletion | Low |
| 5 | Data migration | Low |

**Key design decisions:**
- Junction table (`filter_tags`) over denormalized `filter_count` column - enables cascading operations
- JSONB remains source of truth for filter logic; junction table enables efficient queries and cascading
- Orphaned tags (removed from filter, no content) remain in `tags` table - user can delete via Settings

**No backwards compatibility concerns** - this is additive functionality that fixes existing bugs.
