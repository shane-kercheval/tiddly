/**
 * Draft-autosave localStorage keys — single source of truth.
 *
 * Draft writers (Bookmark/Note/Prompt) and the account-deletion cleanup must
 * agree on the key scheme, so both go through here rather than hand-building
 * `tiddly:draft:...` strings (which previously lived at each call site and
 * could silently drift from any bulk-cleanup logic).
 *
 * NOTE (deletion teardown — accepted limitation): these keys are NOT namespaced
 * by user, and localStorage is per-browser-origin. So on account deletion,
 * `clearAllDrafts()` (and the sibling BYOK-key clear) wipe *every* draft/key in
 * the browser, not just the deleted account's. A cross-account guard (api.tsx)
 * prevents this from running for a *different, currently-active* account, so a
 * live account is never signed out or torn down by another account's deletion.
 * The residual: when the account being deleted is the active one, any OTHER
 * account's leftover local drafts/keys in the same browser are cleared too.
 * Worst case is a local-cache wipe, never a data deletion (no account deleted,
 * server-side data untouched). Accepted at beta scale rather than namespacing
 * every draft/key by user id; see the teardown in AuthProvider and the plan.
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
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(DRAFT_KEY_PREFIX)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Storage unavailable/blocked — clearing drafts is best-effort and must
    // never throw out of the account-deletion teardown (see AuthProvider).
  }
}
