/**
 * Zustand store for the session-expiry contract (migration plan M3, step 7).
 *
 * With the free tier's fixed 7-day sessions, mid-edit expiry is a routine
 * event. The contract, enforced here and in SessionExpiredDialog:
 *
 * - Expiry NEVER navigates or clears state. The page (and any in-memory editor
 *   content) stays exactly as it is; sign-in is presented in place.
 * - Requests that failed on the expired session are parked, and automatically
 *   retried after a successful re-auth — the save the user attempted completes
 *   with nothing to redo.
 * - There is deliberately NO dismiss/escape path (decision 2026-07-12, from
 *   the live rehearsal): the app shell can't render meaningful content without
 *   auth, so "keep me on the page" was a blank shell — and draft autosave
 *   already guarantees nothing is lost (the work restores on reload, even if
 *   sign-in itself is broken). Re-auth is the one path forward.
 * - `queryClient.clear()` and consent reset happen ONLY on deliberate logout,
 *   never on this path.
 */
import { create } from 'zustand'

interface PendingRequest {
  retry: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  /** The original 401 error, surfaced to the caller if the store is reset (logout). */
  originalError: unknown
}

interface SessionExpiryState {
  /** True from the first expired-session 401 until a successful re-auth. */
  expired: boolean
  /**
   * True between a deliberate logout starting and the next sign-in. Lets
   * ProtectedRoute distinguish "user logged out" (navigate away, correct)
   * from "session died mid-use" (stay mounted, raise the dialog).
   */
  deliberateLogout: boolean
  pending: PendingRequest[]
}

interface SessionExpiryActions {
  /**
   * Park a failed request until re-auth. Returns a promise that settles with
   * the retried request's outcome (or rejects with the original error if the
   * store is reset by a deliberate logout).
   */
  parkRequest: <T>(retry: () => Promise<T>, originalError: unknown) => Promise<T>
  /**
   * Raise the expiry dialog with nothing parked — used when the *client*
   * discovers the dead session (Clerk's background refresh flips signed-out)
   * before any API call gets a 401.
   */
  markExpired: () => void
  /** Called by the seam's logout() before signOut, so ProtectedRoute lets the navigation happen. */
  beginDeliberateLogout: () => void
  /** Cleared on the next successful sign-in. */
  clearDeliberateLogout: () => void
  /** Called when re-auth succeeds: retry everything parked, in order. */
  resumeAll: () => void
  /** Deliberate logout or auth teardown: drop everything. */
  reset: () => void
}

type SessionExpiryStore = SessionExpiryState & SessionExpiryActions

export const useSessionExpiryStore = create<SessionExpiryStore>((set, get) => ({
  expired: false,
  deliberateLogout: false,
  pending: [],

  markExpired: () => {
    set({ expired: true })
  },

  beginDeliberateLogout: () => {
    set({ deliberateLogout: true })
  },

  clearDeliberateLogout: () => {
    set({ deliberateLogout: false })
  },

  parkRequest: <T,>(retry: () => Promise<T>, originalError: unknown): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      set((state) => ({
        expired: true,
        pending: [
          ...state.pending,
          {
            retry,
            resolve: resolve as (value: unknown) => void,
            reject,
            originalError,
          },
        ],
      }))
    })
  },

  resumeAll: () => {
    const { pending } = get()
    set({ expired: false, pending: [] })
    for (const request of pending) {
      request.retry().then(request.resolve, request.reject)
    }
  },

  reset: () => {
    const { pending } = get()
    set({ expired: false, pending: [] })
    for (const request of pending) {
      request.reject(request.originalError)
    }
  },
}))
