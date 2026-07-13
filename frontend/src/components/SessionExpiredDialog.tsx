/**
 * The session-expiry UX contract (migration plan M3, step 7), UI half — the
 * request-parking half lives in stores/sessionExpiryStore.
 *
 * Hard requirements this component enforces:
 * - On expiry: NO navigation, ever. The page underneath (editor content
 *   included) never unmounts; sign-in renders as our own in-page overlay,
 *   which browsers have no mechanism to block.
 * - The Google button inside Clerk's <SignIn> uses the POPUP OAuth flow
 *   (`oauthFlow="popup"`, pinned — the default "auto" could pick a same-tab
 *   redirect, which would destroy the page and silently void the contract).
 *   The popup is a real window showing Google's page (Google forbids being
 *   iframed); Clerk opens it synchronously from the click, preserving the
 *   user-gesture chain that popup blockers require.
 * - After successful re-auth the parked requests replay automatically
 *   (resumeAll) — the user's pending save completes with nothing to redo.
 * - No dismiss path: re-auth is the way forward. Nothing is trapped because
 *   draft autosave persists the editor to localStorage; a user who can't or
 *   won't sign in can reload and their work restores (decision 2026-07-12).
 *
 * Also owns the pre-expiry warning: the session's expiry moment is
 * client-knowable (session.expireAt), so a toast fires ahead of it and most
 * re-auths happen at calm moments instead of mid-sentence.
 *
 * This file is one of the few allowed to import the Clerk SDK (see
 * eslint.config.js): it mounts Clerk's prebuilt <SignIn> UI, which cannot be
 * expressed through the seam.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { SignIn, useAuth, useSession } from '@clerk/clerk-react'
import { isDevMode } from '../config'
import { useSessionExpiryStore } from '../stores/sessionExpiryStore'

/** How far ahead of expiry the warning toast fires. */
const WARN_BEFORE_MS = 10 * 60 * 1000

function useSessionExpiryWarning(): void {
  const { session } = useSession()
  const expireAtMs = session?.expireAt ? session.expireAt.getTime() : null

  useEffect(() => {
    if (expireAtMs === null) return
    const delay = expireAtMs - WARN_BEFORE_MS - Date.now()
    // Already inside the warning window (or past it): stay quiet — the
    // expiry dialog handles what comes next.
    if (delay <= 0) return
    const timer = setTimeout(() => {
      toast(
        'Your session expires soon. Save your work, then sign in again to avoid interruption.',
        { id: 'session-expiry-warning', duration: 15_000, icon: '⏳' },
      )
    }, delay)
    return () => clearTimeout(timer)
  }, [expireAtMs])
}

function SessionExpiryGuardInner(): ReactNode {
  const expired = useSessionExpiryStore((state) => state.expired)
  const resumeAll = useSessionExpiryStore((state) => state.resumeAll)
  const { isSignedIn } = useAuth()
  const prevSignedInRef = useRef(isSignedIn)

  useSessionExpiryWarning()

  // Freeze background loading indicators while expired (see index.css):
  // parked requests keep widgets in loading state, and their spinners behind
  // the dim read as breakage. Everything resumes visibly on re-auth.
  useEffect(() => {
    if (expired) {
      document.body.classList.add('session-expired')
      return () => document.body.classList.remove('session-expired')
    }
  }, [expired])

  // Resume only on an actual signed-out -> signed-in TRANSITION, never on the
  // instantaneous boolean: the app can be expired while Clerk's client still
  // reports signed-in (the backend rejects tokens the client believes are fine
  // - ban, clock skew, azp/JWKS misconfiguration). Resuming on the boolean
  // would immediately replay the parked requests, re-park them on the next
  // 401, and loop against the backend forever with nothing visible to the
  // user. Gated on the transition, that desync leaves the dialog up instead -
  // and a genuine re-auth still transitions false -> true, so the working
  // case is unaffected.
  useEffect(() => {
    const wasSignedIn = prevSignedInRef.current
    prevSignedInRef.current = isSignedIn
    if (isSignedIn && !wasSignedIn) {
      // Any successful sign-in ends a logout-in-progress state.
      useSessionExpiryStore.getState().clearDeliberateLogout()
    }
    if (expired && isSignedIn && !wasSignedIn) {
      resumeAll()
    }
  }, [expired, isSignedIn, resumeAll])

  if (!expired) {
    return null
  }

  // No wrapper panel of our own: Clerk's <SignIn> renders a complete card,
  // and nesting it inside a second white dialog read as two bolted-together
  // components (M3 rehearsal feedback). Context text sits on the backdrop.
  // No dismiss control: the shell is unusable without auth, and drafts already
  // protect the work — re-auth is the single path forward.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-full flex-col items-center overflow-y-auto">
        <h2 className="text-lg font-semibold text-white">Your session expired</h2>
        <p className="mt-1 mb-4 max-w-md text-center text-sm text-gray-200">
          Sign back in to continue — your work is saved as a draft and any pending
          save will finish automatically.
        </p>
        <SignIn
          routing="virtual"
          oauthFlow="popup"
          // Pin the post-sign-in destination to the current location: Clerk's
          // default would navigate to `/`. The router bridge treats a
          // same-location target as a no-op, so nothing moves and the
          // unsaved-changes blocker never fires.
          forceRedirectUrl={window.location.pathname + window.location.search}
        />
      </div>
    </div>
  )
}

/**
 * Mounted once at the app root (inside AuthProvider). Renders nothing in dev
 * mode, where there is no Clerk context and no session to expire.
 */
export function SessionExpiryGuard(): ReactNode {
  if (isDevMode) {
    return null
  }
  return <SessionExpiryGuardInner />
}
