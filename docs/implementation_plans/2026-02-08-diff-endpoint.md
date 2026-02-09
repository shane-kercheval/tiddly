# Version Diff Endpoint & Metadata Changes Display

## Overview

Currently, when a user clicks a history row to see what changed at version N, the frontend makes **two independent API calls** — one to reconstruct content at version N and one for version N-1. These share ~90% of the reconstruction work but don't know about each other. Additionally, the `metadata` field returned by both calls is completely unused — so metadata-only changes (title, tags, description, URL, etc.) show only "No content changes in this version (metadata only)" with no information about what actually changed.

This plan:
1. Removes the redundant `diff_type` column from the schema
2. Guarantees bounded reconstruction distance by storing snapshots on modulo-10 metadata-only changes
3. Consolidates the two API calls into a single diff endpoint
4. Adds metadata change display to both the HistorySidebar and SettingsVersionHistory views

**No backwards compatibility required** — the existing `GET /history/{type}/{id}/version/{version}` endpoint can remain as-is (used by restore flow), but the frontend diff views will switch entirely to the new endpoint.

---

## Milestone 0: Remove `diff_type` Column & Snapshot Improvements

### Goal & Outcome

Remove the `diff_type` column from `content_history` — it is fully redundant with other columns. Also guarantee bounded reconstruction distance by storing `content_snapshot` on modulo-10 metadata-only changes.

After this milestone:
- The `DiffType` enum and `diff_type` column no longer exist
- The change type is derived from existing columns: `version IS NULL` → audit, `action = 'create'` → create, `content_diff IS NOT NULL` → content change, else → metadata only
- Metadata-only changes at modulo-10 versions store `content_snapshot`, guaranteeing reconstruction never traverses more than 10 versions
- The partial index `ix_content_history_snapshots` uses `WHERE content_snapshot IS NOT NULL` instead of `WHERE diff_type = 'snapshot'`
- Reconstruction checks `content_snapshot IS NOT NULL` instead of `diff_type == 'snapshot'`

### Implementation Outline

**1. Update `history_service.py` — recording logic:**

Remove all `diff_type` assignment. The recording logic simplifies to just setting the content columns:

```python
async def _record_action_impl(self, ...):
    content_snapshot: str | None = None
    content_diff: str | None = None

    if action_value in self.AUDIT_ACTIONS:
        # Audit: no content, no version
        version = None
    elif action_value == ActionType.CREATE.value:
        # CREATE: snapshot of initial content
        content_snapshot = current_content
        version = await self._get_next_version(...)
    elif previous_content == current_content:
        # Metadata only: no content_diff
        version = await self._get_next_version(...)
        if version % SNAPSHOT_INTERVAL == 0:
            content_snapshot = current_content  # Guarantee bounded reconstruction
    else:
        # Content change
        version = await self._get_next_version(...)
        patches = self.dmp.patch_make(current_content or "", previous_content or "")
        content_diff = self.dmp.patch_toText(patches)
        if version % SNAPSHOT_INTERVAL == 0:
            content_snapshot = current_content  # Periodic snapshot

    history = ContentHistory(
        # ... all fields except diff_type
        content_snapshot=content_snapshot,
        content_diff=content_diff,
        # ...
    )
```

**2. Update `history_service.py` — reconstruction logic:**

Change the snapshot detection from `r.diff_type == DiffType.SNAPSHOT.value and r.content_snapshot is not None` to simply `r.content_snapshot is not None`. This is both simpler and more correct — it picks up snapshots on both content-change and metadata-only records.

**3. Remove `DiffType` enum from `models/content_history.py`:**

Delete the `DiffType` class entirely. Remove the `diff_type` column from the `ContentHistory` model. Update the `DiffType` docstring content into comments on the content columns instead, explaining what combinations mean.

**4. Update `schemas/history.py`:**

Remove `diff_type` from `HistoryResponse` and `ContentAtVersionResponse`. The frontend never reads this field in application code (only in test fixtures and type definitions).

**5. Update the partial index:**

The current partial index `ix_content_history_snapshots` uses `WHERE diff_type = 'snapshot'`. Change to `WHERE content_snapshot IS NOT NULL`. This correctly indexes all snapshot records regardless of whether the change was content or metadata-only.

**6. Database migration:**

**NOTE** always use the `make migration` command. Never create database migrations manually. 

Create an Alembic migration that:
- Drops the `ix_content_history_snapshots` index
- Drops the `diff_type` column
- Creates a new partial index `ix_content_history_snapshots` with `WHERE content_snapshot IS NOT NULL`

Since the feature hasn't been deployed, existing data is dev/test only. No data backfill needed — just drop the column.

**7. Update frontend types:**

Remove `HistoryDiffType` type and `diff_type` field from `HistoryEntry` in `types.ts`.

**8. Update `api/routers/history.py` — restore validation:**

The restore endpoint at line 320 checks `history.diff_type == DiffType.AUDIT.value` to block restoring to audit versions. Replace with an action-based check: `history.action in HistoryService.AUDIT_ACTIONS` (or equivalently, check against the set of audit action strings). Remove the `DiffType` import from the router — it should no longer be needed after this change.

**9. Update `docs/content-versioning.md`:**

This is the primary specification document for the versioning system. Update to reflect the removal of `diff_type`:

- **"Diff Types and Dual Storage" section**: Remove the `diff_type` column from the table. Restructure around what the content columns (`content_snapshot`, `content_diff`) contain per scenario. The table should show: CREATE (snapshot, no diff), content change normal (no snapshot, diff), content change periodic (snapshot + diff), metadata only (neither, or snapshot on modulo-10), audit (neither).
- **"Data Model" section**: Remove `diff_type` from the history record fields table.
- **"Actions Tracked" table**: Remove "Diff Type" column. The action and content columns already convey the same information.
- **"Metadata-Only Changes" section**: Remove reference to `diff_type = METADATA`. Describe in terms of `content_diff is None` with a version present. Add note that modulo-10 metadata-only changes store `content_snapshot` for bounded reconstruction.
- **"Reconstruction Algorithm" section**: Update step references from `SNAPSHOT`/`DIFF`/`METADATA` types to column checks (`content_snapshot is not None`, `content_diff` presence). Update the "Note" about metadata being stored as a full snapshot — clarify the audit exception.
- **"Audit Actions" section**: Already accurate (no diff_type reference needed — just describe the column state).

**10. Update `CLAUDE.md`:**

Update the Content Versioning section to remove references to `DiffType` enum and `diff_type` column. Specifically:
- Remove the "Diff Storage" subsection bullet points about SNAPSHOT/DIFF/METADATA/AUDIT record types
- Replace with column-based description of what `content_snapshot` and `content_diff` contain per scenario
- Add note about modulo-10 metadata snapshots

### Testing Strategy

All test files referencing `diff_type` must be updated. **Verification step**: after Milestone 0 is complete, run `rg diff_type` across the entire codebase and confirm zero matches outside of migration files.

**Backend service tests** (`test_history_service.py` — 16 references):

- Update existing tests that assert `diff_type` values — remove those assertions, replace with assertions on `content_snapshot` and `content_diff` presence:
  - CREATE: `content_snapshot is not None`, `content_diff is None`
  - Content change (normal): `content_snapshot is None`, `content_diff is not None`
  - Content change (modulo-10): `content_snapshot is not None`, `content_diff is not None`
  - Metadata only: `content_diff is None`
  - Audit: `version is None`, `content_snapshot is None`, `content_diff is None`
- `test__record_action__metadata_only_at_snapshot_interval` — Metadata-only change at version 10 stores `content_snapshot` with current content and `content_diff` as `None`
- `test__reconstruct__through_metadata_snapshot` — Verify reconstruction correctly uses a `content_snapshot` stored on a metadata-only record as an anchor point

**Backend integration tests** (`test_history_integration.py` — 24 references):

- Update all assertions that check `diff_type` values — same replacement pattern as service tests (assert on `content_snapshot`/`content_diff` presence instead)

**Backend API tests** (`test_history.py` — 6 references):

- Update assertions that check `diff_type` in responses — remove them
- Verify `diff_type` no longer appears in history response JSON
- Update `test_restore_to_audit_version_returns_400` (line 1273): currently manipulates `diff_type` via direct SQL. Rework to use action-based check — parametrize across all audit actions (`delete`, `undelete`, `archive`, `unarchive`) using `pytest.mark.parametrize`. Each case sets the record's `action` to the audit action value to test that the restore endpoint correctly blocks all audit action types.
- Update `test_restore_to_version_records_restore_action` (line 1344): remove assertion on `diff_type`

**Backend model tests** (`test_content_history.py` — 17 references):

- Remove `DiffType` enum value tests (`test__diff_type__all_values`)
- Update all model construction to not include `diff_type`
- Update assertions to not check `diff_type`

**Backend cascade tests** (`test_user_cascade.py` — 1 reference):

- Update model construction to not include `diff_type`

**Backend cleanup tests** (`test_cleanup.py` — 1 reference):

- Update model construction to not include `diff_type`

**Frontend tests** (`HistorySidebar.test.tsx`, `SettingsVersionHistory.test.tsx`):

- Update test fixtures that include `diff_type` — remove the field
- Remove `HistoryDiffType` references from `types.ts`

---

## Milestone 1: Backend — New Diff Endpoint

### Goal & Outcome

Add a single `GET /history/{type}/{id}/version/{version}/diff` endpoint that returns before/after content and metadata in one response, eliminating redundant reconstruction.

After this milestone:
- The new endpoint reconstructs content at version N and N-1 in a single pass
- Returns `before_content`, `after_content`, `before_metadata`, `after_metadata`
- For version 1 (CREATE), `before_content` and `before_metadata` are `null` (no predecessor); `after_content` has the initial content and `after_metadata` has the initial metadata — enabling the frontend to display initial values
- For metadata-only changes, `before_content` and `after_content` are both `null` (no content to diff)
- The existing `/version/{version}` endpoint remains unchanged (still used by restore flow)

### Implementation Outline

**1. Add `VersionDiffResponse` schema in `schemas/history.py`:**

```python
class VersionDiffResponse(BaseModel):
    """Schema for diff between a version and its predecessor."""
    entity_id: UUID
    version: int
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
    before_content: str | None = None
    after_content: str | None = None
    before_metadata: dict | None = None
    after_metadata: dict | None = None
    warnings: list[str] | None = None
```

Key design decisions:
- No `diff_type` field — the frontend determines what to display from the data itself: if `before_content`/`after_content` are non-null and different, show content diff; if metadata differs, show metadata changes; if `before_metadata` is null, it's a CREATE
- `before_*` fields are `null` for version 1 (CREATE) — there is no predecessor. `after_content` and `after_metadata` are populated with the initial values so the frontend can display them
- For metadata-only changes, `before_content` and `after_content` are both `null` — no point reconstructing and sending identical content
- `warnings` propagates any reconstruction issues (same as existing endpoint)

**2. Add `get_version_diff` method to `HistoryService`:**

**Architecture principle: compose, don't duplicate.** This method reuses the existing, well-tested `reconstruct_content_at_version` for the "after" side, then applies one additional reverse diff to derive the "before" side. This ensures all reconstruction logic (audit record skipping, snapshot optimization, reverse diff traversal, hard-deleted entity handling) is inherited from the existing tested code path with zero duplication.

The approach:

1. **After metadata**: Call `self.get_history_at_version(version=N)` to get `metadata_snapshot` and `content_diff`
2. **Determine if content needs reconstruction**: Content is reconstructed when `content_diff IS NOT NULL` (content changed) OR when the action is `CREATE` (initial content exists even though `content_diff` is `None` for CREATEs)
3. **After content** (only if content needs reconstruction): Call `self.reconstruct_content_at_version(version=N)` — reuses existing tested logic as-is
4. **Before content** (only if `content_diff IS NOT NULL` and version > 1): Apply version N's stored `content_diff` (reverse diff) to the after content. **Invariant**: version N's `content_diff` is a reverse diff (N → N-1), produced by `patch_make(current_content, previous_content)`. One `patch_apply` call gives us N-1's content.
5. **Before metadata** (version > 1): Call `self.get_history_at_version(version=N-1)` to get the predecessor's `metadata_snapshot`
6. **Version 1 (CREATE)**: `before_content` and `before_metadata` are both `null` — no predecessor exists. `after_content` and `after_metadata` are still populated with the initial values (content from reconstruction, metadata from the v1 history record)

```python
async def get_version_diff(self, db, user_id, entity_type, entity_id, version):
    """
    Compute diff between version N and its predecessor N-1.

    Invariant: content_diff at version N is a reverse diff (N → N-1),
    produced by patch_make(current_content, previous_content). Changing
    the diff direction would break the before-content derivation.
    """
    # 1. Get version N's history record
    after_history = await self.get_history_at_version(
        db, user_id, entity_type, entity_id, version,
    )
    if after_history is None:
        return DiffResult(found=False)

    content_diff_exists = after_history.content_diff is not None
    is_create = after_history.action == ActionType.CREATE.value
    # Reconstruct content when it changed OR for CREATE (initial content, no diff)
    needs_content = content_diff_exists or is_create

    after_content = None
    before_content = None
    warnings = None

    if needs_content:
        # 2. Reuse existing tested reconstruction for "after" content
        after_result = await self.reconstruct_content_at_version(
            db, user_id, entity_type, entity_id, version,
        )
        if not after_result.found:
            return DiffResult(found=False)
        after_content = after_result.content
        warnings = after_result.warnings

        # 3. Derive "before" content from version N's reverse diff
        #    (only when content actually changed — not for CREATE)
        if content_diff_exists and version > 1:
            patches = self.dmp.patch_fromText(after_history.content_diff)
            before_content, results = self.dmp.patch_apply(
                patches, after_content or "",
            )
            # Track partial failures in warnings

    # 4. Get "before" metadata from version N-1's record
    before_metadata = None
    if version > 1:
        before_history = await self.get_history_at_version(
            db, user_id, entity_type, entity_id, version - 1,
        )
        before_metadata = before_history.metadata_snapshot if before_history else None

    return DiffResult(
        found=True,
        after_content=after_content,
        before_content=before_content,
        after_metadata=after_history.metadata_snapshot,
        before_metadata=before_metadata,
        warnings=warnings,
    )
```

**Why this design is correct**: The reconstruction algorithm in `reconstruct_content_at_version` applies reverse diffs from versions above the target down to the target, but **excludes the target's own diff** (because that diff goes target → target-1). So when we separately apply version N's `content_diff` to the reconstructed content at N, we get N-1's content. This is a distinct, non-overlapping operation from the reconstruction itself.

**Edge case — pruned predecessor**: If version N-1's history record has been deleted by retention pruning, `get_history_at_version(version - 1)` returns `None`. In this case, `before_metadata` is `null`. The content derivation is unaffected — version N's `content_diff` still produces N-1's content regardless of whether N-1's record exists. The frontend distinguishes this from CREATE by checking the entry's action: if `before_metadata` is null and action is not `create`, it's a pruned predecessor — skip metadata display or show "Previous metadata unavailable".

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
- `test_get_version_diff__returns_before_and_after_content` — Create entity, update content, request diff at v2. Verify `before_content` is original, `after_content` is updated.
- `test_get_version_diff__version_1_create` — Create entity, request diff at v1. Verify `before_content` is `null`, `before_metadata` is `null`, `after_content` has creation content, `after_metadata` has initial metadata.
- `test_get_version_diff__metadata_only_change` — Create entity, update only title/tags (not content), request diff at v2. Verify `before_content` and `after_content` are both `null`, `before_metadata` and `after_metadata` differ.
- `test_get_version_diff__content_and_metadata_change` — Update both content and title simultaneously. Verify content fields differ and metadata fields differ.

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
- `test__get_version_diff__metadata_only_change` — Verify `before_content` and `after_content` are both `None`, and both metadata snapshots are returned with correct values
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
  before_content: string | null
  after_content: string | null
  before_metadata: Record<string, unknown> | null
  after_metadata: Record<string, unknown> | null
  warnings: string[] | null
}
```

**2. Add `useVersionDiff` hook in `hooks/useHistory.ts`:**

Add a new query key entry and hook that calls `GET /history/{type}/{id}/version/{version}/diff`. The hook signature should mirror `useContentAtVersion` (same enable guard: `version !== null && version >= 1`).

Remove the two `useContentAtVersion` usage patterns from `HistorySidebar.tsx` and `SettingsVersionHistory.tsx` — replace with a single `useVersionDiff` call. After this change, `useContentAtVersion` has no remaining callers (the restore flow uses `useRestoreToVersion`, which calls the restore POST endpoint directly). Remove `useContentAtVersion` from `hooks/useHistory.ts`.

**3. Create `MetadataChanges` component:**

Create `frontend/src/components/MetadataChanges.tsx`. This component receives `beforeMetadata` (nullable for v1), `afterMetadata`, and `entityType` (to know which fields are relevant).

**Display rules by scenario:**

| Scenario | How to detect | What to show |
|----------|--------------|-------------|
| CREATE (v1) — `beforeMetadata` is null | `before_metadata` is null and entry action is `create` | List non-empty fields from `afterMetadata` as plain values (no arrows, no diff) |
| Pruned predecessor — `beforeMetadata` is null | `before_metadata` is null and entry action is NOT `create` | Skip metadata section or show "Previous metadata unavailable" message. Content diff still works (derived from the diff, not the predecessor record). |
| Metadata unchanged (`before == after`) | Deep equality check | Nothing — don't render the component |
| Metadata changed | Fields differ between before/after | Field-by-field changes, only showing changed fields |

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

Replace the two `useContentAtVersion` hooks and the `previousVersion` computation with a single `useVersionDiff` call. The parent component decides what to render based on the data:

```tsx
{selectedVersion === entry.version && entry.version !== null && (
  <div className="border-t border-gray-200 bg-gray-50">
    {/* Metadata changes (if any) */}
    <MetadataChanges
      beforeMetadata={diffData?.before_metadata ?? null}
      afterMetadata={diffData?.after_metadata ?? null}
      entityType={entityType}
    />
    {/* Content diff — only render when content fields are present */}
    {(diffData?.before_content != null || diffData?.after_content != null) && (
      <DiffView
        oldContent={diffData?.before_content ?? ''}
        newContent={diffData?.after_content ?? ''}
        isLoading={!diffData}
      />
    )}
  </div>
)}
```

The `MetadataChanges` component handles its own visibility — it renders nothing when metadata is unchanged. The `DiffView` is only rendered when the endpoint returns content (non-null `before_content` or `after_content`). For metadata-only changes, both are null, so `DiffView` is skipped entirely — no need for the "No content changes" message.

**5. Update `SettingsVersionHistory.tsx`:**

Same pattern as the sidebar — replace two hooks with one, add `MetadataChanges` above `DiffView`. The Settings page already has `entity_type` from `selectedEntry.entity_type` to pass to `MetadataChanges`.

**6. Update `DiffView.tsx`:**

The "No content changes in this version (metadata only)" message at lines 143-148 can be removed. The parent components now conditionally render `DiffView` only when content is present, so this code path is no longer reachable from history views. However, since `DiffView` is a generic component that could be used elsewhere, consider keeping the identical-content handling but updating the message to be more generic (e.g., "No changes") or removing it if no other callers pass identical content.

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
- `renders pruned predecessor message when before_metadata is null and action is not create` — Distinguishes pruned from CREATE

**`useContentAtVersion` removal verification:**

- Verify via `rg useContentAtVersion` that no imports or references remain after removal
- Remove any related query key entries from `historyKeys`

**`HistorySidebar` test updates** — update `frontend/src/components/HistorySidebar.test.tsx`:

- Update existing diff view tests to mock `useVersionDiff` instead of two `useContentAtVersion` calls
- Add test: clicking metadata-only entry shows metadata changes but no content diff
- Add test: clicking content+metadata entry shows both sections

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

- Verify `previousVersion` computation and `useContentAtVersion` calls have been fully removed in Milestone 2 — run `rg useContentAtVersion` and `rg previousVersion` to confirm no stale references.
- Remove the `DiffView` "No content changes" message if no callers can reach it, or update it to be generic.

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
