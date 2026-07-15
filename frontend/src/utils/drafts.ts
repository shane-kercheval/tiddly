/**
 * Draft-autosave localStorage keys — single source of truth.
 *
 * Draft writers (Bookmark/Note/Prompt) and the account-deletion cleanup must
 * agree on the key scheme, so both go through here rather than hand-building
 * `tiddly:draft:...` strings (which previously lived at each call site and
 * could silently drift from any bulk-cleanup logic).
 *
 * NOTE (deletion teardown): these keys are NOT namespaced by user — localStorage
 * is per-browser-origin, so `clearAllDrafts()` clears every draft in the browser,
 * not just one account's. Accepted at current scale; see the account-deletion
 * teardown in AuthProvider and the deletion notes in the migration plan.
 */
export const DRAFT_KEY_PREFIX = 'tiddly:draft:'

/** Build the autosave key for an item, e.g. `tiddly:draft:note:<id>` (or `...:new`). */
export function draftKey(type: 'bookmark' | 'note' | 'prompt', id: string): string {
  return `${DRAFT_KEY_PREFIX}${type}:${id}`
}

/**
 * Remove every autosave draft from localStorage. Used on account deletion to
 * clear the deleted user's in-progress local content. Iterates in reverse so
 * removals don't shift indices mid-loop.
 */
export function clearAllDrafts(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key?.startsWith(DRAFT_KEY_PREFIX)) {
      localStorage.removeItem(key)
    }
  }
}
