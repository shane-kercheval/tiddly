/**
 * Draft autosave for the content editors (migration plan M3, step 8).
 *
 * Independent scope from the session-expiry contract: step 7 fully handles
 * expiry on a live page; drafts protect against what no expiry UX can — the
 * page dying with unsaved work in it (Cmd+W, Cmd+Q, browser crash, power
 * loss). Bonus interaction: a draft also rescues step 7's one degraded case,
 * a blocked re-auth popup.
 *
 * History note: a per-component version of this was removed in #52 as
 * redundant with beforeunload warnings — which don't cover crash/power-loss
 * or session expiry. M3 reinstates it deliberately, as one shared hook.
 *
 * PERFORMANCE GUARDRAIL: the form state is serialized ONLY inside a periodic
 * (2s) snapshot callback while dirty, never per keystroke or change event —
 * that boundary is the entire difference between imperceptible and typing
 * lag. (A snapshot interval rather than a trailing debounce, so sustained
 * typing still checkpoints every 2s instead of only at pauses; loss is capped
 * at the interval.) The localStorage write itself is sub-millisecond at
 * Tiddly note sizes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const DEBOUNCE_MS = 2000

export interface SavedDraft<T> {
  data: T
  savedAt: number
}

interface UseDraftAutosaveOptions<T> {
  /** Unique per item, e.g. `tiddly:draft:note:<id>` (or `...:new` for unsaved items). */
  storageKey: string
  /** The live form state. Read inside the debounced callback only. */
  current: T
  /** Drafts are written only while there are unsaved changes. */
  isDirty: boolean
  /** Read-only views never write drafts. */
  disabled?: boolean
}

interface UseDraftAutosaveResult<T> {
  /**
   * A draft left over from a previous session, surfaced once on mount for a
   * restore prompt. Null when none exists or after restore/discard resolves it.
   */
  pendingDraft: SavedDraft<T> | null
  /** Accept the pending draft: returns its data for the caller to apply. */
  restoreDraft: () => T | null
  /** Reject the pending draft and delete it from storage. */
  discardDraft: () => void
  /**
   * Delete the current key's stored draft. MUST be called from the
   * save-success path, immediately after the save resolves: a successful
   * CREATE navigates to the new item's id, changing the storage key before
   * the isDirty inference could clear the ':new' entry — and only the save
   * path can distinguish "saved" (clear it) from "abandoned mid-create"
   * (keep it recoverable), since both leave the key behind.
   */
  clearDraft: () => void
}

function readDraft<T>(storageKey: string): SavedDraft<T> | null {
  try {
    const stored = localStorage.getItem(storageKey)
    if (!stored) return null
    const parsed = JSON.parse(stored) as SavedDraft<T>
    if (typeof parsed?.savedAt !== 'number' || parsed.data === undefined) return null
    return parsed
  } catch {
    return null
  }
}

export function useDraftAutosave<T>({
  storageKey,
  current,
  isDirty,
  disabled = false,
}: UseDraftAutosaveOptions<T>): UseDraftAutosaveResult<T> {
  // Captured once per storageKey before any write/clear can run, so a
  // lingering draft survives long enough to be offered back to the user.
  const [pendingDraft, setPendingDraft] = useState<SavedDraft<T> | null>(() =>
    disabled ? null : readDraft<T>(storageKey),
  )

  // Re-arm when the key changes (e.g. navigating between items that reuse the
  // mounted component) — the render-adjust pattern, not an effect, so the new
  // key's lingering draft is visible on the very first render.
  const [armedKey, setArmedKey] = useState(storageKey)
  if (armedKey !== storageKey) {
    setArmedKey(storageKey)
    setPendingDraft(disabled ? null : readDraft<T>(storageKey))
  }

  // Reads state without retriggering the snapshot effect on every keystroke:
  // the effect below depends on `isDirty` transitions, not on `current`.
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  })
  // Keyed, so an item switch can never mistake the previous item's dirtiness
  // for this one's and delete a draft it shouldn't.
  const wasDirtyRef = useRef<{ key: string; dirty: boolean }>({ key: storageKey, dirty: false })

  useEffect(() => {
    if (disabled) return

    if (!isDirty) {
      // Clean state after having been dirty means the work was saved (or
      // reverted) — the draft's job is done. The mount-time clean state must
      // NOT clear: it would delete the lingering draft before the user
      // answers the restore prompt.
      const marker = wasDirtyRef.current
      if (marker.key === storageKey && marker.dirty) {
        wasDirtyRef.current = { key: storageKey, dirty: false }
        try {
          localStorage.removeItem(storageKey)
        } catch {
          // Storage unavailable: nothing to clean up.
        }
      }
      return
    }

    wasDirtyRef.current = { key: storageKey, dirty: true }
    const interval = setInterval(() => {
      try {
        const draft: SavedDraft<T> = { data: currentRef.current, savedAt: Date.now() }
        localStorage.setItem(storageKey, JSON.stringify(draft))
      } catch {
        // Quota exceeded or storage unavailable — drafts are best-effort.
      }
    }, DEBOUNCE_MS)
    return () => clearInterval(interval)
  }, [isDirty, storageKey, disabled])

  const restoreDraft = useCallback((): T | null => {
    const draft = pendingDraft
    setPendingDraft(null)
    return draft ? draft.data : null
  }, [pendingDraft])

  const discardDraft = useCallback((): void => {
    setPendingDraft(null)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable: nothing to clean up.
    }
  }, [storageKey])

  const clearDraft = useCallback((): void => {
    wasDirtyRef.current = { key: storageKey, dirty: false }
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable: nothing to clean up.
    }
  }, [storageKey])

  return { pendingDraft, restoreDraft, discardDraft, clearDraft }
}
