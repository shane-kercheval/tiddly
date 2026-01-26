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

Fully normalize the filter expression storage. Replace the JSONB `filter_expression` column with proper relational tables:

- `filter_groups` - stores each group in the filter with its position and operator
- `filter_group_tags` - junction table linking groups to tags

This enables:
1. **Single source of truth** - Tags are referenced by ID, not name strings
2. **Automatic cascade on rename** - Tag renames just work (FK references ID)
3. **Safe delete handling** - API blocks deletion of tags used in filters (409 Conflict), requiring explicit removal from filters first
4. **Tag visibility** - Tags in filters can be included in `/tags/` via simple joins

**API contract unchanged** - The request/response format stays exactly the same. Normalization/denormalization happens in the service layer.

---

## Milestone 1: Database Schema + Data Migration

### Goal
Create the new normalized tables, migrate existing data from JSONB, and remove the JSONB column.

### Success Criteria
- `filter_groups` table exists with proper constraints
- `filter_group_tags` junction table exists with foreign keys
- All existing filter data migrated to new tables
- `Tag` records created for any tags that don't exist yet
- `group_operator` extracted from JSONB to column on `content_filters`
- `filter_expression` JSONB column removed from `content_filters`
- Migration is reversible (rollback recreates JSONB with correct data)

### Key Changes

**1. Create `filter_groups` table (`models/filter_group.py` or add to `content_filter.py`):**

```python
class FilterGroup(Base):
    __tablename__ = "filter_groups"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    filter_id: Mapped[UUID] = mapped_column(
        ForeignKey("content_filters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(nullable=False)  # Order within filter
    operator: Mapped[str] = mapped_column(String(10), default="AND")  # Always "AND" for now

    # Relationships
    content_filter: Mapped["ContentFilter"] = relationship(back_populates="groups")
    tag_objects: Mapped[list["Tag"]] = relationship(
        secondary="filter_group_tags",
        order_by="Tag.name",
    )

    __table_args__ = (
        # Ensure unique positions within a filter
        UniqueConstraint("filter_id", "position", name="uq_filter_groups_filter_position"),
    )
```

**2. Create `filter_group_tags` junction table (`models/tag.py`):**

```python
filter_group_tags = Table(
    "filter_group_tags",
    Base.metadata,
    Column("group_id", ForeignKey("filter_groups.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_filter_group_tags_tag_id", "tag_id"),
)
```

Note: The `ondelete="CASCADE"` on `tag_id` is for referential integrity, but we block tag deletion at the application layer if the tag is used in any filters (see Milestone 5). The CASCADE is a safety net that maintains DB consistency.

**3. Update `ContentFilter` model:**

```python
class ContentFilter(Base):
    # ... existing fields ...

    # Remove: filter_expression JSONB column

    # Keep group_operator on the filter (it's filter-level, not group-level)
    group_operator: Mapped[str] = mapped_column(String(10), default="OR")

    # Add relationship to groups
    groups: Mapped[list["FilterGroup"]] = relationship(
        back_populates="content_filter",
        cascade="all, delete-orphan",
        order_by="FilterGroup.position",
    )
```

**4. Create Alembic migration:**

Use `make migration message="normalize filter expression to filter_groups and filter_group_tags"`.

The migration should:
1. Add `group_operator` column to `content_filters`
2. Create `filter_groups` table
3. Create `filter_group_tags` table
4. Migrate data from `filter_expression` JSONB to new tables
5. Drop `filter_expression` column

```python
def upgrade():
    # 1. Add group_operator column
    op.add_column("content_filters", sa.Column("group_operator", sa.String(10), server_default="OR"))

    # 2. Create filter_groups table
    op.create_table(
        "filter_groups",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("filter_id", sa.UUID(), sa.ForeignKey("content_filters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("operator", sa.String(10), server_default="AND"),
        sa.UniqueConstraint("filter_id", "position", name="uq_filter_groups_filter_position"),
    )
    op.create_index("ix_filter_groups_filter_id", "filter_groups", ["filter_id"])

    # 3. Create filter_group_tags junction table
    op.create_table(
        "filter_group_tags",
        sa.Column("group_id", sa.UUID(), sa.ForeignKey("filter_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.UUID(), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_filter_group_tags_tag_id", "filter_group_tags", ["tag_id"])

    # 4. Migrate data
    connection = op.get_bind()

    filters = connection.execute(
        text("SELECT id, user_id, filter_expression FROM content_filters")
    ).fetchall()

    for filter_row in filters:
        filter_id = filter_row.id
        user_id = filter_row.user_id
        expression = filter_row.filter_expression

        if not expression:
            continue

        # Extract group_operator
        group_operator = expression.get("group_operator", "OR")
        connection.execute(
            text("UPDATE content_filters SET group_operator = :op WHERE id = :id"),
            {"op": group_operator, "id": filter_id}
        )

        # Process each group
        for position, group in enumerate(expression.get("groups", [])):
            tag_names = group.get("tags", [])
            operator = group.get("operator", "AND")

            if not tag_names:
                continue

            # Create filter_group
            group_id = uuid7()
            connection.execute(
                text("""
                    INSERT INTO filter_groups (id, filter_id, position, operator)
                    VALUES (:id, :filter_id, :position, :operator)
                """),
                {"id": group_id, "filter_id": filter_id, "position": position, "operator": operator}
            )

            # Get or create tags and link to group
            for tag_name in tag_names:
                normalized_name = tag_name.lower().strip()

                tag_result = connection.execute(
                    text("SELECT id FROM tags WHERE user_id = :user_id AND name = :name"),
                    {"user_id": user_id, "name": normalized_name}
                ).fetchone()

                if tag_result:
                    tag_id = tag_result.id
                else:
                    tag_id = uuid7()
                    connection.execute(
                        text("INSERT INTO tags (id, user_id, name) VALUES (:id, :user_id, :name)"),
                        {"id": tag_id, "user_id": user_id, "name": normalized_name}
                    )

                connection.execute(
                    text("""
                        INSERT INTO filter_group_tags (group_id, tag_id)
                        VALUES (:group_id, :tag_id)
                        ON CONFLICT DO NOTHING
                    """),
                    {"group_id": group_id, "tag_id": tag_id}
                )

    # 5. Drop old column
    op.drop_column("content_filters", "filter_expression")
```

**5. Verification queries (for manual verification after migration):**

```sql
-- Verify group counts match original
SELECT cf.id, cf.name, COUNT(fg.id) as group_count
FROM content_filters cf
LEFT JOIN filter_groups fg ON fg.filter_id = cf.id
GROUP BY cf.id, cf.name;

-- Verify tags are linked correctly
SELECT cf.name as filter_name, fg.position, array_agg(t.name ORDER BY t.name) as tags
FROM content_filters cf
JOIN filter_groups fg ON fg.filter_id = cf.id
JOIN filter_group_tags fgt ON fgt.group_id = fg.id
JOIN tags t ON t.id = fgt.tag_id
GROUP BY cf.name, fg.filter_id, fg.position
ORDER BY cf.name, fg.position;
```

### Testing Strategy

**Migration tests:**
- Migration applies cleanly on empty database
- Migration applies with existing filters (data migrated correctly)
- Migration rolls back cleanly (JSONB restored with correct data)
- Filters with empty expressions handled (no groups created)
- Filters with multiple groups preserve order
- Tags that already exist are reused (not duplicated)
- New tags are created

**Schema tests (after migration):**
- Tables have correct constraints (FKs, unique position per filter)
- CASCADE delete: deleting a filter removes groups and junction entries
- CASCADE delete: deleting a group removes junction entries

### Dependencies
None

### Risk Factors
- Large datasets may need batching in migration
- Ensure rollback correctly reconstructs JSONB from normalized data

---

## Milestone 2: Service Layer - Write Path

### Goal
Update `content_filter_service.py` to write to normalized tables instead of JSONB.

### Success Criteria
- `create_filter` creates `FilterGroup` records and links tags
- `update_filter` syncs groups (add/remove/reorder as needed)
- API request format unchanged
- `Tag` records created for new tags (via existing `get_or_create_tags`)

### Key Changes

**1. Update `create_filter` in `content_filter_service.py`:**

```python
async def create_filter(
    db: AsyncSession,
    user_id: UUID,
    data: ContentFilterCreate,
) -> ContentFilter:
    content_filter = ContentFilter(
        user_id=user_id,
        name=data.name,
        content_types=data.content_types,
        group_operator=data.filter_expression.group_operator,
        default_sort_by=data.default_sort_by,
        default_sort_ascending=data.default_sort_ascending,
    )
    db.add(content_filter)
    await db.flush()  # Get filter ID

    # Create groups with tags
    await _sync_filter_groups(db, user_id, content_filter, data.filter_expression.groups)

    await db.refresh(content_filter)
    await add_filter_to_sidebar(db, user_id, content_filter.id)

    return content_filter


async def _sync_filter_groups(
    db: AsyncSession,
    user_id: UUID,
    content_filter: ContentFilter,
    groups: list[FilterGroup],  # Pydantic schema, not ORM model
) -> None:
    """Sync filter groups and their tags. Replaces all existing groups."""
    # Delete existing groups (cascade deletes junction entries)
    await db.execute(
        delete(FilterGroupModel).where(FilterGroupModel.filter_id == content_filter.id)
    )

    # Create new groups
    for position, group in enumerate(groups):
        if not group.tags:
            continue

        # Get or create tags
        tag_objects = await get_or_create_tags(db, user_id, group.tags)

        filter_group = FilterGroupModel(
            filter_id=content_filter.id,
            position=position,
            operator=group.operator,
        )
        filter_group.tag_objects = tag_objects
        db.add(filter_group)

    await db.flush()
```

**2. Update `update_filter`:**

```python
async def update_filter(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
    data: ContentFilterUpdate,
) -> ContentFilter | None:
    content_filter = await get_filter(db, user_id, filter_id)
    if content_filter is None:
        return None

    # Update scalar fields
    if data.name is not None:
        content_filter.name = data.name
    if data.content_types is not None:
        content_filter.content_types = data.content_types
    if data.default_sort_by is not None:
        content_filter.default_sort_by = data.default_sort_by
    if data.default_sort_ascending is not None:
        content_filter.default_sort_ascending = data.default_sort_ascending

    # Update filter expression (groups + group_operator)
    if data.filter_expression is not None:
        content_filter.group_operator = data.filter_expression.group_operator
        await _sync_filter_groups(db, user_id, content_filter, data.filter_expression.groups)

    content_filter.updated_at = func.clock_timestamp()
    await db.flush()
    await db.refresh(content_filter)
    return content_filter
```

### Testing Strategy

**Service-level tests (`test_content_filter_service.py`):**

**Create tests:**
- `test__create_filter__creates_filter_groups` - Groups created with correct positions
- `test__create_filter__creates_tags_for_new_tag_names` - Tag records created
- `test__create_filter__reuses_existing_tags` - Existing tags linked, not duplicated
- `test__create_filter__links_tags_to_groups` - Junction entries exist
- `test__create_filter__empty_groups_skipped` - Groups with no tags not created
- `test__create_filter__multiple_groups_correct_positions` - Position ordering preserved

**Update tests - basic:**
- `test__update_filter__replaces_groups` - Old groups deleted, new ones created
- `test__update_filter__preserves_groups_when_expression_not_provided` - Partial update works
- `test__update_filter__updates_group_operator` - group_operator changes correctly

**Update tests - tag management:**
- `test__update_filter__removes_tag_from_filter` - Tag removed from expression but still exists in tags table
- `test__update_filter__adds_existing_tag` - Tag already in DB is reused, not duplicated
- `test__update_filter__adds_new_tag` - New tag created in tags table
- `test__update_filter__mixed_existing_and_new_tags` - Combination of reused and new tags

**Update tests - group structure:**
- `test__update_filter__to_empty_expression` - All groups removed, filter has no groups
- `test__update_filter__reorders_groups` - Same tags but different group positions
- `test__update_filter__same_tags_different_grouping` - Tags split across groups differently
- `test__update_filter__adds_group` - Adds additional group to existing groups
- `test__update_filter__removes_group` - Removes one group, keeps others

**Update tests - junction table verification:**
- `test__update_filter__cleans_up_old_junction_entries` - Old filter_group_tags entries removed
- `test__update_filter__orphaned_tags_remain_in_db` - Tags removed from filter still exist in tags table

### Dependencies
- Milestone 1 complete (schema + data migrated)

### Risk Factors
- Ensure `_sync_filter_groups` properly deletes old groups before creating new
- Verify SQLAlchemy cascade behavior

---

## Milestone 3: Service Layer - Read Path

### Goal
Update filter retrieval to reconstruct the `filter_expression` JSON structure from normalized tables.

### Success Criteria
- `get_filter` returns filter with reconstructed `filter_expression`
- `get_filters` returns list with reconstructed expressions
- API response format unchanged
- Efficient queries (avoid N+1)

### Key Changes

**1. Update `ContentFilterResponse` schema (`schemas/content_filter.py`):**

The schema stays the same - it expects `filter_expression` as a nested object. We need to reconstruct this from the ORM model.

```python
class ContentFilterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    content_types: list[ContentType]
    filter_expression: FilterExpression  # Reconstructed from groups relationship
    default_sort_by: str | None
    default_sort_ascending: bool | None
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def build_filter_expression(cls, data: Any) -> Any:
        """Reconstruct filter_expression from normalized groups."""
        if hasattr(data, "groups"):
            # ORM model - reconstruct expression
            groups = [
                {
                    "tags": [tag.name for tag in group.tag_objects],
                    "operator": group.operator,
                }
                for group in sorted(data.groups, key=lambda g: g.position)
            ]
            # Convert to dict for Pydantic
            data_dict = {
                "id": data.id,
                "name": data.name,
                "content_types": data.content_types,
                "filter_expression": {
                    "groups": groups,
                    "group_operator": data.group_operator,
                },
                "default_sort_by": data.default_sort_by,
                "default_sort_ascending": data.default_sort_ascending,
                "created_at": data.created_at,
                "updated_at": data.updated_at,
            }
            return data_dict
        return data
```

**2. Update queries to eagerly load groups and tags:**

```python
async def get_filter(
    db: AsyncSession,
    user_id: UUID,
    filter_id: UUID,
) -> ContentFilter | None:
    query = (
        select(ContentFilter)
        .options(
            selectinload(ContentFilter.groups).selectinload(FilterGroup.tag_objects)
        )
        .where(
            ContentFilter.id == filter_id,
            ContentFilter.user_id == user_id,
        )
    )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_filters(db: AsyncSession, user_id: UUID) -> list[ContentFilter]:
    query = (
        select(ContentFilter)
        .options(
            selectinload(ContentFilter.groups).selectinload(FilterGroup.tag_objects)
        )
        .where(ContentFilter.user_id == user_id)
        .order_by(ContentFilter.created_at)
    )
    result = await db.execute(query)
    return list(result.scalars().all())
```

### Testing Strategy

**API-level tests (`test_filters.py`):**
- `test__get_filter__returns_filter_expression_format` - Response has correct structure
- `test__get_filters__returns_filter_expression_for_all` - List endpoint works
- `test__create_and_get_filter__roundtrip` - Create filter, get it back, expression matches
- `test__get_filter__orders_groups_by_position` - Groups in correct order
- `test__get_filter__orders_tags_alphabetically` - Tags sorted within group

### Dependencies
- Milestone 2 complete

### Risk Factors
- Pydantic `model_validator` with `mode="before"` can be tricky - test thoroughly
- Ensure eager loading prevents N+1 queries

---

## Milestone 4: Update Tags API to Include Filter Tags

### Goal
Modify `/tags/` endpoint to include tags that are used in filters, even with count=0.

### Success Criteria
- Tags used only in filters appear in `/tags/` response
- Tags used only in filters have `count: 0`
- Tags used in both filters and content have correct content count
- No duplicate tags in response

### Key Changes

**1. Update `get_user_tags_with_counts` in `tag_service.py`:**

```python
async def get_user_tags_with_counts(
    db: AsyncSession,
    user_id: UUID,
    include_inactive: bool = False,
) -> list[TagCount]:
    # Subquery: tags used in filters (via filter_group_tags)
    filter_tag_subq = (
        select(filter_group_tags.c.tag_id)
        .join(FilterGroup, filter_group_tags.c.group_id == FilterGroup.id)
        .join(ContentFilter, FilterGroup.filter_id == ContentFilter.id)
        .where(ContentFilter.user_id == user_id)
        .distinct()
    ).subquery()

    in_filter_subq = (
        select(literal(1))
        .select_from(filter_tag_subq)
        .where(filter_tag_subq.c.tag_id == Tag.id)
        .exists()
    )

    # ... existing count subqueries for bookmarks, notes, prompts ...

    query = (
        select(Tag.name, total_count)
        .where(Tag.user_id == user_id)
        .group_by(Tag.id, Tag.name)
        .order_by(total_count.desc(), Tag.name.asc())
    )

    if not include_inactive:
        # Include tags with count > 0 OR tags used in filters
        query = query.having((total_count > 0) | in_filter_subq)

    result = await db.execute(query)
    return [TagCount(name=row.name, count=row.count) for row in result]
```

### Testing Strategy

**API-level tests (`test_tags.py`):**
- `test__list_tags__includes_tags_from_filters` - Filter-only tags appear
- `test__list_tags__filter_tags_have_zero_count` - Count is 0 for filter-only tags
- `test__list_tags__tag_in_filter_and_content_has_content_count` - No double counting
- `test__list_tags__filter_deleted_removes_tag_from_list` - Tag disappears when filter deleted (if not used elsewhere)

### Dependencies
- Milestone 3 complete

### Risk Factors
- Query performance with additional subquery - benchmark if needed

---

## Milestone 5: Tag Rename Cascades + Block Delete if Used in Filters

### Goal
- Verify tag renames automatically propagate to filters via FK relationships
- Block tag deletion if the tag is used in any filters (require user to remove from filters first)

### Success Criteria
- Renaming a tag: filters continue to work (they reference tag by ID)
- Deleting a tag used in filters: returns 409 Conflict with list of affected filter names
- Deleting a tag not used in filters: succeeds as before
- Frontend displays clear error message when deletion blocked

### Key Changes

**1. Tag rename - no code changes needed:**

Works automatically via FK relationships:
- `Tag.name` is updated
- `filter_group_tags` references `tag_id` (unchanged)
- Filter response reconstructs expression using new tag name

**2. Update `delete_tag` in `tag_service.py` to check for filter usage:**

```python
class TagInUseByFiltersError(Exception):
    """Raised when trying to delete a tag that is used in filters."""

    def __init__(self, tag_name: str, filter_names: list[str]) -> None:
        self.tag_name = tag_name
        self.filter_names = filter_names
        super().__init__(
            f"Tag '{tag_name}' is used in {len(filter_names)} filter(s): {', '.join(filter_names)}"
        )


async def get_filters_using_tag(
    db: AsyncSession,
    user_id: UUID,
    tag_id: UUID,
) -> list[str]:
    """Get names of filters that use a specific tag."""
    result = await db.execute(
        select(ContentFilter.name)
        .join(FilterGroup, ContentFilter.id == FilterGroup.filter_id)
        .join(filter_group_tags, FilterGroup.id == filter_group_tags.c.group_id)
        .where(
            ContentFilter.user_id == user_id,
            filter_group_tags.c.tag_id == tag_id,
        )
        .distinct()
    )
    return list(result.scalars().all())


async def delete_tag(
    db: AsyncSession,
    user_id: UUID,
    tag_name: str,
) -> None:
    # ... existing validation to get tag ...

    # Check if tag is used in any filters
    filter_names = await get_filters_using_tag(db, user_id, tag.id)
    if filter_names:
        raise TagInUseByFiltersError(tag_name, filter_names)

    # Proceed with deletion
    await db.delete(tag)
    await db.flush()
```

**3. Update `tags.py` router to handle new error:**

```python
from services.tag_service import TagInUseByFiltersError

@router.delete("/{tag_name}", status_code=204)
async def delete_tag(
    tag_name: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        await tag_service.delete_tag(db, current_user.id, tag_name)
    except TagNotFoundError:
        raise HTTPException(status_code=404, detail=f"Tag '{tag_name}' not found")
    except TagInUseByFiltersError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Cannot delete tag '{e.tag_name}' because it is used in filters",
                "filters": e.filter_names,
            },
        )
```

**4. Frontend: Handle 409 response in Tags settings page:**

Display error message like:
> Cannot delete tag "work". It is used in the following filters: Work Tasks, Priority Items.
> Please remove the tag from these filters before deleting.

### Testing Strategy

**API-level tests (`test_tags.py`):**
- `test__rename_tag__filter_uses_new_name` - Get filter after rename, expression shows new name
- `test__rename_tag__filter_still_matches_content` - Filter functionality unchanged
- `test__delete_tag__blocked_when_used_in_filter` - Returns 409 with filter names
- `test__delete_tag__blocked_lists_multiple_filters` - Multiple filter names in response
- `test__delete_tag__succeeds_when_not_in_filters` - Tag not in any filter deletes normally
- `test__delete_tag__succeeds_after_removing_from_filter` - Update filter to remove tag, then delete succeeds

### Dependencies
- Milestone 4 complete

### Risk Factors
- None significant - this is a safer approach than cascading deletes

---

## Milestone 6: Update Filter Application Logic

### Goal
Update the code that applies filters to content queries to work with normalized structure.

### Success Criteria
- `build_filter_from_expression` works with new ORM structure
- Filtering bookmarks/notes/prompts by filter_id still works
- Performance comparable to JSONB approach

### Key Changes

**1. Update filter application in `content_service.py` or relevant location:**

The filter logic needs to work with `FilterGroup` ORM objects instead of JSONB dicts.

```python
def build_filter_from_groups(
    groups: list[FilterGroup],
    group_operator: str,
    entity_class: type[Bookmark | Note | Prompt],
    user_id: UUID,
) -> ColumnElement[bool] | None:
    """Build SQLAlchemy filter from normalized filter groups."""
    if not groups:
        return None

    group_conditions = []
    for group in groups:
        if not group.tag_objects:
            continue

        tag_names = [tag.name for tag in group.tag_objects]

        if group.operator == "AND":
            # Must have ALL tags in group
            tag_conditions = []
            for tag_name in tag_names:
                subq = (
                    select(1)
                    .select_from(entity_tags_table)  # bookmark_tags, note_tags, etc.
                    .join(Tag)
                    .where(
                        entity_tags_table.c.entity_id == entity_class.id,
                        Tag.name == tag_name,
                        Tag.user_id == user_id,
                    )
                )
                tag_conditions.append(subq.exists())
            if tag_conditions:
                group_conditions.append(and_(*tag_conditions))

    if not group_conditions:
        return None

    if group_operator == "OR":
        return or_(*group_conditions)
    else:
        return and_(*group_conditions)
```

**2. Update callers to pass ORM groups instead of JSONB:**

```python
# In list endpoints
resolved = await resolve_filter_and_sorting(db, current_user.id, filter_id, sort_by, sort_order)

if resolved.filter_groups:
    filter_condition = build_filter_from_groups(
        resolved.filter_groups,
        resolved.group_operator,
        Bookmark,
        current_user.id,
    )
    if filter_condition is not None:
        query = query.where(filter_condition)
```

### Testing Strategy

**Existing filter tests should pass:**
- `test_list_bookmarks_with_filter_id`
- `test_list_bookmarks_with_filter_id_complex_filter`
- `test_list_content_with_filter_id__*`

**Additional tests:**
- `test__filter__after_tag_rename_still_matches` - Rename tag, filter still finds content
- `test__filter__after_tag_delete_excludes_that_criteria` - Delete tag, filter ignores that tag

### Dependencies
- Milestone 5 complete

### Risk Factors
- Ensure query performance is acceptable
- May need to adjust eager loading for filter resolution

---

## Summary

| Milestone | Focus | Risk |
|-----------|-------|------|
| 1 | Database schema + data migration | Medium |
| 2 | Service layer - write path | Medium |
| 3 | Service layer - read path | Medium |
| 4 | Tags API includes filter tags | Low |
| 5 | Tag rename/delete handling | Low |
| 6 | Filter application logic | Medium |

**Key design decisions:**
- Fully normalized schema (no JSONB for filter expressions)
- Single source of truth - tags referenced by FK, not name strings
- API contract unchanged - normalization/denormalization in service layer
- Tag renames cascade automatically via FK relationships
- Tag deletes blocked if used in filters (409 Conflict) - user must remove from filters first

**Benefits over JSONB approach:**
- No sync logic needed between JSONB and junction tables
- Tag renames just work (FK references ID, not name)
- Cleaner relational design
- Explicit user action required before breaking filters
