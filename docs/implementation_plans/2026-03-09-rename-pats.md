# Rename Personal Access Tokens (PATs)

Add the ability to rename PATs in the API and web UI, following the same patterns used for tag renaming.

## Context

PATs currently support create, list, and delete. There is no update/rename capability — users must delete and recreate a token to change its name. This plan adds a rename endpoint and inline editing UI matching the tag rename pattern.

**Key differences from tags:**
- PAT names have no uniqueness constraint (two tokens can share a name) — no conflict/409 handling needed
- PAT names are free-form strings (1-100 chars) — no normalization like tags (lowercase, hyphens)
- PATs are identified by UUID, not by name — the rename endpoint uses `token_id` path param, not name
- No cache invalidation needed — PAT renames don't affect filters, content lists, or other state

## Reference Files

**Tag rename pattern (follow this):**
- Backend: `backend/src/api/routers/tags.py` (PATCH endpoint), `backend/src/services/tag_service.py` (`rename_tag`), `backend/src/schemas/tag.py` (`TagRenameRequest`)
- Frontend: `frontend/src/pages/settings/SettingsTags.tsx` (inline editing UI — page owns editing state, `TagRow` is presentational), `frontend/src/stores/tagsStore.ts` (`renameTag` action)
- Tests: `backend/tests/api/test_tags.py` (`test_rename_tag_*`), `backend/tests/services/test_tag_service.py` (`test__rename_tag__*`)

**PAT code to modify:**
- Backend: `backend/src/api/routers/tokens.py`, `backend/src/services/token_service.py`, `backend/src/schemas/token.py`
- Frontend: `frontend/src/components/TokenList.tsx`, `frontend/src/stores/tokensStore.ts`, `frontend/src/pages/settings/SettingsTokens.tsx`, `frontend/src/types.ts`
- Tests: `backend/tests/api/test_tokens.py`, `backend/tests/services/test_token_service.py`

---

## Milestone 1: Backend — Rename PAT API Endpoint

### Goal & Outcome

Add a `PATCH /tokens/{token_id}` endpoint to rename a PAT. Also fix whitespace validation on `TokenCreate` for consistency.

After this milestone:
- API consumers can rename a PAT by ID
- Name validation (1-100 chars, non-empty, whitespace-stripped) is enforced consistently on both create and rename
- The endpoint is Auth0-only (consistent with other token management endpoints)
- Renaming to the same name is a no-op that returns success

### Implementation Outline

1. **Schema** (`backend/src/schemas/token.py`): Add `TokenRenameRequest` with a `new_name` field. Use `ConfigDict(str_strip_whitespace=True)` for automatic whitespace stripping before validation — this is simpler than a hand-rolled `field_validator` and ensures `"   "` correctly fails `min_length=1`.

   Also add `str_strip_whitespace=True` to `TokenCreate` for consistency. Currently `TokenCreate.name` has no stripping, so whitespace-only names like `"   "` pass `min_length=1` — this is a bug.

   ```python
   class TokenCreate(BaseModel):
       model_config = ConfigDict(str_strip_whitespace=True)
       # ... existing fields unchanged

   class TokenRenameRequest(BaseModel):
       model_config = ConfigDict(str_strip_whitespace=True)
       new_name: str = Field(..., min_length=1, max_length=100)
   ```

2. **Service** (`backend/src/services/token_service.py`): Add `rename_token` function. Follow the existing tokens module pattern: return `ApiToken | None` (matching `get_token_by_id` and the bool pattern of `delete_token`), let the router handle the 404. No custom exception class needed.

   ```python
   async def rename_token(db, user_id, token_id, new_name) -> ApiToken | None:
       token = await get_token_by_id(db, user_id, token_id)
       if token is None:
           return None
       token.name = new_name
       await db.flush()
       await db.refresh(token)
       return token
   ```

   Note: whitespace stripping is handled by the schema's `ConfigDict(str_strip_whitespace=True)`, so the service receives an already-stripped name.

3. **Router** (`backend/src/api/routers/tokens.py`): Add a PATCH endpoint. Check for `None` return and raise `HTTPException(404)` directly, matching the delete endpoint pattern (lines 66-68).

   ```python
   @router.patch("/{token_id}", response_model=TokenResponse)
   async def rename_token_endpoint(
       token_id: UUID,
       rename_request: TokenRenameRequest,
       current_user: User = Depends(get_current_user_auth0_only),
       db: AsyncSession = Depends(get_async_session),
   ) -> TokenResponse:
       token = await token_service.rename_token(
           db, current_user.id, token_id, rename_request.new_name,
       )
       if token is None:
           raise HTTPException(status_code=404, detail="Token not found")
       return TokenResponse.model_validate(token)
   ```

### Testing Strategy

Add tests in `backend/tests/api/test_tokens.py`:
- `test_rename_token_success` — rename a token, verify response has new name
- `test_rename_token_not_found` — 404 for nonexistent token ID
- `test_rename_token_other_users_token` — 404 when trying to rename another user's token (user scoping)
- `test_rename_token_validates_name` — 422 for empty string, whitespace-only, and string > 100 chars
- `test_rename_token_strips_whitespace` — leading/trailing whitespace is stripped
- `test_rename_token_same_name` — succeeds (no-op) when renaming to same name
- `test_rename_token_rejects_pat_auth` — 403 when calling PATCH with a PAT bearer token (Auth0-only enforcement)
- `test_create_token_strips_whitespace` — verify `TokenCreate` now strips whitespace
- `test_create_token_rejects_whitespace_only` — verify `"   "` fails validation on create

Add tests in `backend/tests/services/test_token_service.py`:
- `test__rename_token__updates_name` — verify name is updated in DB
- `test__rename_token__returns_none_for_missing` — returns `None` for invalid ID
- `test__rename_token__user_scoping` — returns `None` when token belongs to different user

---

## Milestone 2: Frontend — Inline Rename UI and Type Fix

### Goal & Outcome

Add inline editing to the token list UI, following the same UX pattern as `SettingsTags.tsx`. Also fix a pre-existing type mismatch in `TokenCreateResponse`.

After this milestone:
- Users can click an edit icon on a token row to enter inline edit mode
- The token name becomes an editable text input with Save/Cancel buttons
- Escape key cancels editing
- Enter key or Save button submits
- Errors display inline below the input
- Only one token can be edited at a time
- `TokenCreateResponse` type correctly matches backend response

### Implementation Outline

1. **Types** (`frontend/src/types.ts`):

   Add `TokenRenameRequest`:
   ```typescript
   export interface TokenRenameRequest {
     new_name: string
   }
   ```

   Fix `TokenCreateResponse` — currently `extends Token` which includes `last_used_at`, but the backend `TokenCreateResponse` schema does not return `last_used_at`. This causes `undefined` to sneak into state where TypeScript expects `string | null`. Make it a standalone interface matching the actual backend response:
   ```typescript
   export interface TokenCreateResponse {
     id: string
     name: string
     token: string
     token_prefix: string
     expires_at: string | null
     created_at: string
   }
   ```

2. **Store** (`frontend/src/stores/tokensStore.ts`):

   Add `renameToken` action following `tagsStore.renameTag` pattern:
   ```typescript
   renameToken: async (id: string, newName: string) => {
     const body: TokenRenameRequest = { new_name: newName }
     const response = await api.patch<Token>(`/tokens/${id}`, body)
     const { tokens } = get()
     set({ tokens: tokens.map((t) => t.id === id ? { ...t, name: response.data.name } : t) })
     return response.data
   }
   ```

   Fix `createToken` to use `last_used_at: null` explicitly (instead of reading `undefined` from `newToken.last_used_at`):
   ```typescript
   const tokenForList: Token = {
     id: newToken.id,
     name: newToken.name,
     token_prefix: newToken.token_prefix,
     last_used_at: null,  // Not returned by create endpoint
     expires_at: newToken.expires_at,
     created_at: newToken.created_at,
   }
   ```

3. **TokenList component** (`frontend/src/components/TokenList.tsx`): Add inline editing to token rows. `TokenList` stays presentational — it receives editing state and callbacks as props, following the `TagRow` pattern in `SettingsTags.tsx`:
   - Add `EditIcon` button to each token row (from `components/icons`)
   - When editing: show text input replacing the token name, with Save/Cancel buttons
   - Escape key cancels, Enter key saves
   - Error display inline below input
   - Loading state on Save button

   New props on `TokenListProps`:
   ```typescript
   editingState: { tokenId: string; newName: string; error: string | null } | null
   onStartEdit: (tokenId: string) => void
   onCancelEdit: () => void
   onSaveEdit: () => Promise<void>
   onEditChange: (value: string) => void
   ```

4. **SettingsTokens page** (`frontend/src/pages/settings/SettingsTokens.tsx`): Own the editing state (matching `SettingsTags.tsx` pattern). The page manages `EditingState`, handles validation, calls the store, and interprets errors:
   ```typescript
   const [editingState, setEditingState] = useState<EditingState | null>(null)

   const handleStartEdit = (tokenId: string, currentName: string): void => {
     setEditingState({ tokenId, newName: currentName, error: null })
   }

   const handleSaveEdit = async (): Promise<void> => {
     if (!editingState) return
     const trimmed = editingState.newName.trim()
     // Validate: non-empty, max 100 chars
     // No change check
     // Call renameToken, handle errors inline or via toast
   }
   ```
   Pass editing state and callbacks down to `TokenList`.

### Testing Strategy

No unit tests needed for frontend (project doesn't have frontend unit tests). Manually verify:
- Edit icon appears on each token row
- Clicking edit enters inline edit mode with current name pre-filled
- Save updates the name and exits edit mode
- Cancel (button or Escape) exits edit mode without changes
- Empty name shows validation error
- API error (e.g., 404) shows error message
- Only one token can be edited at a time
- Loading state (Save button shows "Saving...") during API call
