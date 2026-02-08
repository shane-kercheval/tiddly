# Version Diff Endpoint & Metadata Changes Display

## Overview

Currently, when a user clicks a history row to see what changed at version N, the frontend makes **two independent API calls** — one to reconstruct content at version N and one for version N-1. These share ~90% of the reconstruction work but don't know about each other. Additionally, the `metadata` field returned by both calls is completely unused — so metadata-only changes (title, tags, description, URL, etc.) show only "No content changes in this version (metadata only)" with no information about what actually changed.

This plan consolidates the two calls into a single diff endpoint and adds metadata change display to both the HistorySidebar and SettingsVersionHistory views.

**No backwards compatibility required** — the existing `GET /history/{type}/{id}/version/{version}` endpoint can remain as-is (used by restore flow), but the frontend diff views will switch entirely to the new endpoint.

---

## Milestone 1: Backend — New Diff Endpoint

### Goal & Outcome

Add a single `GET /history/{type}/{id}/version/{version}/diff` endpoint that returns before/after content and metadata in one response, eliminating redundant reconstruction.

After this milestone:
- The new endpoint reconstructs content at version N and N-1 in a single pass
- Returns `before_content`, `after_content`, `before_metadata`, `after_metadata`
- For version 1 (CREATE), `before_content` is `null` and `before_metadata` is `null`
- For METADATA diff_type records, `before_content` equals `after_content` (content unchanged)
- The existing `/version/{version}` endpoint remains unchanged (still used by restore flow)

### Implementation Outline

**1. Add `VersionDiffResponse` schema in `schemas/history.py`:**

```python
class VersionDiffResponse(BaseModel):
    """Schema for diff between a version and its predecessor."""
    entity_id: UUID
    version: int
    diff_type: DiffType
    before_content: str | None
    after_content: str | None
    before_metadata: dict | None
    after_metadata: dict | None
    warnings: list[str] | None = None
```

Also add a `DiffResult` dataclass in `services/history_service.py` (alongside the existing `ReconstructionResult`):

```python
@dataclass
class DiffResult:
    """Result of version diff computation."""
    found: bool
    diff_type: str | None = None
    before_content: str | None = None
    after_content: str | None = None
    before_metadata: dict | None = None
    after_metadata: dict | None = None
    warnings: list[str] | None = None
```

Key design decisions:
- Include `diff_type` so the frontend knows whether this is a content change, metadata-only change, or a create — avoids the frontend having to infer from content equality
- `before_*` fields are `null` for version 1 (CREATE) — there is no predecessor
- `warnings` propagates any reconstruction issues (same as existing endpoint)

**2. Add `get_version_diff` method to `HistoryService`:**

**Architecture principle: compose, don't duplicate.** This method reuses the existing, well-tested `reconstruct_content_at_version` for the "after" side, then applies one additional reverse diff to derive the "before" side. This ensures all reconstruction logic (audit record skipping, snapshot optimization, reverse diff traversal, hard-deleted entity handling) is inherited from the existing tested code path with zero duplication.

The approach:

1. **After content**: Call `self.reconstruct_content_at_version(version=N)` — reuses existing tested logic as-is
2. **After metadata**: Call `self.get_history_at_version(version=N)` to get `metadata_snapshot`
3. **Before content** (version > 1): Apply version N's stored `content_diff` (reverse diff) to the after content — version N's diff by definition transforms N → N-1, so one `patch_apply` call gives us N-1's content
4. **Before metadata** (version > 1): Call `self.get_history_at_version(version=N-1)` to get the predecessor's `metadata_snapshot`
5. **Version 1 (CREATE)**: `before_content` and `before_metadata` are both `null` — no predecessor exists

```python
async def get_version_diff(self, db, user_id, entity_type, entity_id, version):
    # 1. Reuse existing tested reconstruction for "after" content
    after_result = await self.reconstruct_content_at_version(
        db, user_id, entity_type, entity_id, version,
    )
    if not after_result.found:
        return DiffResult(found=False, ...)

    # 2. Get version N's history record (content_diff + after_metadata)
    after_history = await self.get_history_at_version(
        db, user_id, entity_type, entity_id, version,
    )

    # 3. Derive "before" content from version N's reverse diff
    if version == 1:
        before_content = None
    elif after_history.diff_type == DiffType.METADATA.value:
        before_content = after_result.content  # content unchanged
    elif after_history.content_diff:
        patches = self.dmp.patch_fromText(after_history.content_diff)
        before_content, results = self.dmp.patch_apply(
            patches, after_result.content or "",
        )
        # Track partial failures in warnings
    else:
        before_content = after_result.content

    # 4. Get "before" metadata from version N-1's record
    before_metadata = None
    if version > 1:
        before_history = await self.get_history_at_version(
            db, user_id, entity_type, entity_id, version - 1,
        )
        before_metadata = before_history.metadata_snapshot if before_history else None

    return DiffResult(
        found=True,
        after_content=after_result.content,
        before_content=before_content,
        after_metadata=after_history.metadata_snapshot,
        before_metadata=before_metadata,
        diff_type=after_history.diff_type,
        warnings=after_result.warnings,
    )
```

**Why this design is correct**: The reconstruction algorithm in `reconstruct_content_at_version` applies reverse diffs from versions above the target down to the target, but **excludes the target's own diff** (because that diff goes target → target-1). So when we separately apply version N's `content_diff` to the reconstructed content at N, we get N-1's content. This is a distinct, non-overlapping operation from the reconstruction itself.

**Edge case — pruned predecessor**: If version N-1's history record has been deleted by retention pruning, `get_history_at_version(version - 1)` returns `None`. In this case, `before_metadata` is `null`. The content derivation is unaffected — version N's `content_diff` still produces N-1's content regardless of whether N-1's record exists. The frontend should handle `before_metadata: null` gracefully (skip metadata diff section or show "Previous metadata unavailable").

**3. Add the endpoint in `api/routers/history.py`:**

```python
@router.get(
    "/{entity_type}/{entity_id}/version/{version}/diff",
    response_model=VersionDiffResponse,
)
async def get_version_diff(
    entity_type: EntityType,
    entity_id: UUID,
    version: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> VersionDiffResponse:
```

Place this route **before** the existing `/{entity_type}/{entity_id}/version/{version}` route in the file to avoid FastAPI interpreting "diff" as a `{version}` path parameter. Alternatively, since `version` is typed as `int` and "diff" won't match `int`, this may not be an issue — verify during implementation.

### Testing Strategy

Add tests to `backend/tests/api/test_history.py` following the existing patterns (use `AsyncClient`, parametrize across entity types where appropriate):

**Core behavior:**
- `test_get_version_diff__returns_before_and_after_content` — Create entity, update content, request diff at v2. Verify `before_content` is original, `after_content` is updated, `diff_type` is `diff` or `snapshot`.
- `test_get_version_diff__version_1_create` — Create entity, request diff at v1. Verify `before_content` is `null`, `before_metadata` is `null`, `after_content` has creation content, `after_metadata` has initial metadata.
- `test_get_version_diff__metadata_only_change` — Create entity, update only title/tags (not content), request diff at v2. Verify `before_content == after_content`, `diff_type` is `metadata`, `before_metadata` and `after_metadata` differ.
- `test_get_version_diff__content_and_metadata_change` — Update both content and title simultaneously. Verify all four fields differ appropriately.

**Edge cases:**
- `test_get_version_diff__version_not_found` — Request non-existent version. Expect 404.
- `test_get_version_diff__hard_deleted_entity` — Expect 404.
- `test_get_version_diff__reconstruction_warnings_propagated` — If reconstruction has issues, verify `warnings` field is populated.
- `test_get_version_diff__multiple_versions_chain` — Create, update 3 times, request diff at each version. Verify correct before/after pairs throughout the chain.

**Auth:**
- `test_get_version_diff__cross_user_isolation` — User 2 cannot access User 1's entity diff. Expect 404.

Add unit tests to `backend/tests/services/test_history_service.py`. Since `get_version_diff` composes the existing `reconstruct_content_at_version` (already thoroughly tested), these tests should focus on the **composition logic** — the before-side derivation, metadata retrieval, and edge cases specific to the diff method:

- `test__get_version_diff__basic_content_change` — Verify `before_content` is derived correctly by applying version N's reverse diff to `after_content`
- `test__get_version_diff__version_1_no_predecessor` — Verify `before_content` and `before_metadata` are both `None`
- `test__get_version_diff__metadata_only_change` — Verify `before_content == after_content` and both metadata snapshots are returned with correct values
- `test__get_version_diff__content_and_metadata_change` — Both content and metadata differ between before/after
- `test__get_version_diff__pruned_predecessor` — Version N-1's record has been deleted. Verify `before_content` is still derived correctly (from N's diff), but `before_metadata` is `None`
- `test__get_version_diff__multiple_versions_sequential` — Build a chain of 4+ versions, request diff at each. Verify each diff's `before_content` matches the previous diff's `after_content` (chain consistency)

---

## Milestone 2: Frontend — Switch to Diff Endpoint & Add Metadata Display

### Goal & Outcome

Replace the two `useContentAtVersion` calls with a single `useVersionDiff` hook, and add a `MetadataChanges` component that displays metadata diffs alongside content diffs.

After this milestone:
- Clicking a history row makes **one** API call instead of two
- Metadata changes are displayed: field-by-field for short fields, diff viewer for description
- CREATE (v1) rows show initial metadata values (non-empty fields only)
- Both HistorySidebar and SettingsVersionHistory use the new components

### Implementation Outline

**1. Add TypeScript type in `types.ts`:**

```typescript
export interface VersionDiffResponse {
  entity_id: string
  version: number
  diff_type: HistoryDiffType
  before_content: string | null
  after_content: string | null
  before_metadata: Record<string, unknown> | null
  after_metadata: Record<string, unknown> | null
  warnings: string[] | null
}
```

**2. Add `useVersionDiff` hook in `hooks/useHistory.ts`:**

Add a new query key entry and hook that calls `GET /history/{type}/{id}/version/{version}/diff`. The hook signature should mirror `useContentAtVersion` (same enable guard: `version !== null && version >= 1`).

Remove the two `useContentAtVersion` usage patterns from `HistorySidebar.tsx` and `SettingsVersionHistory.tsx` — replace with a single `useVersionDiff` call. The `useContentAtVersion` hook itself should remain (it's still used by the restore flow).

**3. Create `MetadataChanges` component:**

Create `frontend/src/components/MetadataChanges.tsx`. This component receives `beforeMetadata` (nullable for v1), `afterMetadata`, and `entityType` (to know which fields are relevant).

**Display rules by scenario:**

| Scenario | What to show |
|----------|-------------|
| CREATE (v1) — `beforeMetadata` is null | List non-empty fields from `afterMetadata` as plain values (no arrows, no diff) |
| Metadata unchanged (`before == after`) | Nothing — don't render the component |
| Metadata changed | Field-by-field changes, only showing changed fields |

**Display rules by field type:**

| Field | Treatment |
|-------|-----------|
| `title`, `url`, `name` | Arrow notation: `"old value" → "new value"`. Show `(empty)` for blank/missing strings. |
| `description` | Use `DiffView` (the existing diff viewer component) when changed. It handles short and long text well. |
| `tags` | Colored chips: green for added tags, red for removed tags. Compute by comparing arrays. |
| `arguments` (prompt-only) | Show "Arguments changed" without deep diffing. This is a list of objects and deep-diffing adds complexity with little UX value. |

**Field label mapping** — use human-readable labels:
- `title` → "Title"
- `description` → "Description"
- `url` → "URL"
- `name` → "Name"
- `tags` → "Tags"
- `arguments` → "Arguments"

**Known fields per entity type** (controls which fields to check/display):
- Bookmark: `title`, `description`, `tags`, `url`
- Note: `title`, `description`, `tags`
- Prompt: `title`, `description`, `tags`, `name`, `arguments`

**4. Update `HistorySidebar.tsx`:**

Replace the two `useContentAtVersion` hooks and the `previousVersion` computation with a single `useVersionDiff` call. Update the inline diff section to:

```tsx
{selectedVersion === entry.version && entry.version !== null && (
  <div className="border-t border-gray-200 bg-gray-50">
    {/* Metadata changes (if any) */}
    <MetadataChanges
      beforeMetadata={diffData?.before_metadata ?? null}
      afterMetadata={diffData?.after_metadata ?? null}
      entityType={entityType}
    />
    {/* Content diff */}
    <DiffView
      oldContent={diffData?.before_content ?? ''}
      newContent={diffData?.after_content ?? ''}
      isLoading={!diffData}
    />
  </div>
)}
```

The `MetadataChanges` component handles its own visibility — it renders nothing when metadata is unchanged.

**5. Update `SettingsVersionHistory.tsx`:**

Same pattern as the sidebar — replace two hooks with one, add `MetadataChanges` above `DiffView`. Note: the Settings page needs the `entity_type` from `selectedEntry.entity_type` to pass to `MetadataChanges` (it already has this).

**6. Update `DiffView.tsx`:**

Remove or update the special case at lines 143-148 that shows "No content changes in this version (metadata only)." Since metadata changes will now be displayed by `MetadataChanges`, the DiffView should still show this message when content is identical (it's accurate), but the surrounding context now provides the metadata detail.

Actually, consider: with the new `diff_type` available from the response, the parent components can decide whether to show `DiffView` at all for metadata-only changes. When `diff_type === 'metadata'`, show only `MetadataChanges`. When `diff_type` is `'diff'` or `'snapshot'`, show both. This avoids the "No content changes" message entirely for metadata-only records.

### Testing Strategy

**`MetadataChanges` component tests** — create `frontend/src/components/MetadataChanges.test.tsx`:

- `renders nothing when metadata unchanged` — Same before/after metadata, component returns null
- `renders nothing when both metadata are null` — Edge case
- `renders initial values for v1 (before is null)` — Shows non-empty after fields as plain values
- `renders title change with arrow notation` — `"Old" → "New"`
- `renders url change with arrow notation`
- `renders name change with arrow notation`
- `renders empty to non-empty with (empty) label` — e.g., description was "" now has content
- `renders tag additions as green chips`
- `renders tag removals as red chips`
- `renders tag additions and removals together`
- `renders arguments changed message` — Prompt-only, just text indicator
- `skips unchanged fields` — Only title changed, tags/description/url not shown
- `renders description change with DiffView` — When description changes, renders a DiffView sub-component for it
- `respects entity type for field visibility` — Bookmark shows url, Note doesn't; Prompt shows name/arguments, others don't

**`HistorySidebar` test updates** — update `frontend/src/components/HistorySidebar.test.tsx`:

- Update existing diff view tests to mock `useVersionDiff` instead of two `useContentAtVersion` calls
- Add test: clicking metadata-only entry shows metadata changes but no content diff

**`SettingsVersionHistory` test updates** — update `frontend/src/pages/settings/SettingsVersionHistory.test.tsx`:

- Same updates: switch mocks from `useContentAtVersion` to `useVersionDiff`
- Add test: metadata-only entry shows metadata changes

**`useHistory` hook tests** — update `frontend/src/hooks/useHistory.test.ts`:

- Add query key tests for the new `historyKeys.diff(entityType, entityId, version)` key

---

## Milestone 3: Polish & Edge Cases

### Goal & Outcome

Handle remaining edge cases, ensure consistent styling, and clean up any dead code.

After this milestone:
- All edge cases handled gracefully
- Unused code removed
- Consistent visual treatment across sidebar and settings views

### Implementation Outline

**1. Handle edge cases in `MetadataChanges`:**

- **Missing fields in metadata snapshots** (schema evolution): If a field exists in `after_metadata` but not in `before_metadata` (or vice versa), treat the missing side as empty/null. This handles older history records that may not have all fields.
- **Null vs empty string**: Treat `null` and `""` as equivalent for display purposes — don't show a "change" from `null` to `""`.
- **Tags ordering**: Sort tags before comparing to avoid false diffs from reordering. Check if the backend already sorts — if so, this may be unnecessary, but defensive sorting is cheap.

**2. Visual consistency:**

- Ensure `MetadataChanges` styling is consistent between HistorySidebar (narrower, constrained width) and SettingsVersionHistory (wider, table context). The component should be responsive.
- When both metadata and content changed, add a subtle visual separator between the metadata section and the content diff (e.g., a thin border or small heading).
- For the description DiffView within MetadataChanges, use a smaller `maxHeight` than the main content DiffView (e.g., 200px) since it's one field among many.

**3. Clean up:**

- Remove the `previousVersion` computation and second `useContentAtVersion` call from both `HistorySidebar.tsx` and `SettingsVersionHistory.tsx` (should already be done in Milestone 2, but verify no references remain).
- If `useContentAtVersion` is no longer used anywhere after these changes, consider removing it. Check if the restore flow or any other code still uses it — if so, keep it.
- Update the `DiffView` "No content changes" message if needed, or remove it if the parent components now handle this case by not rendering `DiffView` for metadata-only records.

### Testing Strategy

**Edge case tests** (add to `MetadataChanges.test.tsx`):

- `handles missing field in before_metadata` — Field exists in after but not before (old schema)
- `handles missing field in after_metadata` — Field exists in before but not after (shouldn't happen but defensive)
- `treats null and empty string as equivalent` — No false diff shown
- `handles null tags gracefully` — Tags field is null instead of array
- `handles tag reordering without showing false diff` — Same tags, different order

**Integration-level verification** (manual or test):

- Create a bookmark, update only tags → verify sidebar shows tag changes
- Create a note, update only title → verify sidebar shows title change with arrows
- Create a prompt, update content + title + tags → verify sidebar shows metadata section above content diff
- Click v1 (CREATE) → verify initial metadata values displayed
- Navigate to Settings > Version History, click same entries → verify identical behavior
