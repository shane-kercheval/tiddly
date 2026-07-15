import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { config, isDevMode } from '../config'
import { setupAuthInterceptor } from '../services/api'
import { useAIStore } from '../stores/aiStore'
import { useConsentStore } from '../stores/consentStore'
import { useSessionExpiryStore } from '../stores/sessionExpiryStore'
import { clearAllDrafts } from '../utils/drafts'
import { queryClient } from '../queryClient'
import { toSafeReturnTo } from '../utils/returnTo'
import { AuthSeamProvider } from './AuthSeamProvider'
import type { AuthActions } from '../hooks/useAuthActions'

/** Clerk may hand the router an absolute URL; compare and navigate path-relative. */
function stripOrigin(to: string): string {
  return to.startsWith(window.location.origin)
    ? to.slice(window.location.origin.length) || '/'
    : to
}

function isSameLocation(to: string): boolean {
  return stripOrigin(to) === window.location.pathname + window.location.search
}

interface AuthProviderProps {
  children: ReactNode
}

// Stable no-op actions for dev mode: the app never renders login/logout
// controls there, but the seam must still resolve everywhere.
const DEV_ACTIONS: AuthActions = {
  login: () => console.warn('[auth] login() is a no-op in dev mode'),
  logout: () => console.warn('[auth] logout() is a no-op in dev mode'),
}

const DEV_STATUS = {
  isAuthenticated: true,
  isLoading: false,
  error: null,
  userId: 'dev-user',
  userEmail: null,
} as const

// Applied to every prebuilt Clerk surface (sign-in/sign-up modals, the
// session-expiry dialog's <SignIn>, <UserProfile />): brand-align with
// Tiddly's UI (gray-900 primary actions, rounded-lg) and center modals
// vertically — Clerk's default floats them near the top, unlike our own
// dialogs (consent, session expiry), which center.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#111827', // Tailwind gray-900, matching our primary buttons
    colorText: '#111827', // gray-900 — our heading/body text color
    colorTextSecondary: '#6b7280', // gray-500 — our secondary text
    borderRadius: '0.5rem', // rounded-lg
    fontFamily: 'inherit', // use the app's font stack, not Clerk's default
  },
  elements: {
    modalBackdrop: { alignItems: 'center' },
    // Flatten the component card to match our settings cards (bordered, no
    // drop shadow) so <UserProfile /> reads as part of the page, not an embed.
    cardBox: 'shadow-none border border-gray-200',
  },
}

/**
 * Bridges the Clerk SDK onto the seam: status (isAuthenticated/loading/
 * error/userId/userEmail) and actions (login/logout). This component is the
 * only place SDK hooks are read for seam purposes — call sites consume
 * useAuthStatus()/useAuthActions() and never the SDK (lint-enforced).
 *
 * Login opens Clerk's prebuilt modal (no hosted-page redirect). Without an
 * explicit returnTo, Clerk's default post-login destination is `/`, where the
 * landing page redirects signed-in users into the app — preserving the
 * Auth0-era "log in, land in the app" behavior. A returnTo (sanitized here,
 * where it becomes a navigation target) overrides that.
 *
 * Deliberate logout owns ALL teardown (consent reset, query-cache clear,
 * session-expiry state) — the session-expiry path must never do any of it
 * (plan M3 step 7: expiry may not destroy page state).
 */
function AuthSeamProviderProd({ children }: AuthProviderProps): ReactNode {
  const { isLoaded, isSignedIn, userId } = useAuth()
  const { user } = useUser()
  const clerk = useClerk()
  const resetConsent = useConsentStore((state) => state.reset)

  const actions = useMemo<AuthActions>(
    () => ({
      login: ({ mode = 'login', returnTo } = {}) => {
        const redirect = returnTo ? { forceRedirectUrl: toSafeReturnTo(returnTo) } : {}
        if (mode === 'signup') {
          void clerk.openSignUp(redirect)
        } else {
          void clerk.openSignIn(redirect)
        }
      },
      logout: () => {
        resetConsent()
        queryClient.clear()
        useSessionExpiryStore.getState().reset()
        // AFTER reset (which clears it): tells ProtectedRoute the coming
        // signed-out transition is deliberate, so it navigates instead of
        // raising the expiry dialog.
        useSessionExpiryStore.getState().beginDeliberateLogout()
        void clerk.signOut({ redirectUrl: window.location.origin })
      },
    }),
    [clerk, resetConsent],
  )

  // Only a hard init failure ('error': clerk-js failed to load) blocks auth
  // and surfaces ProtectedRoute's recovery screen; 'degraded' means partially
  // operational — the app still functions, so it is deliberately not fatal.
  // isLoading must drop when errored, or the loading branch would mask the
  // error screen forever (isLoaded never becomes true on a failed init).
  const initFailed = clerk.status === 'error'

  return (
    <AuthSeamProvider
      status={{
        isAuthenticated: isSignedIn ?? false,
        isLoading: !isLoaded && !initFailed,
        error: initFailed
          ? new Error('Authentication service failed to load. Please try again.')
          : null,
        userId: userId ?? null,
        userEmail: user?.primaryEmailAddress?.emailAddress ?? null,
      }}
      actions={actions}
    >
      {children}
    </AuthSeamProvider>
  )
}

/**
 * Inner component that sets up the API interceptors once Clerk is available.
 *
 * getToken() returns clerk-js's cached ~60s session token (refreshed in the
 * background — this replaces the Auth0 refresh-token machinery; there is no
 * client-held refresh token anymore). The interceptor passes
 * `{ skipCache: true }` on its one 401 retry to force a fresh mint.
 */
function AuthInterceptorSetup({ children }: AuthProviderProps): ReactNode {
  const { getToken } = useAuth()
  const clerk = useClerk()
  const resetConsent = useConsentStore((state) => state.reset)

  // Terminal deleted-account teardown (see services/api.tsx). Mirrors deliberate
  // logout's teardown, PLUS clears the deleted user's persisted secrets (BYOK
  // API keys) and drafts, then hard-navigates to /account-deleted — guaranteed
  // even if signOut fails or hangs (a full load also unmounts the editor/expiry
  // UI so nothing keeps operating on the dead session). localStorage is per
  // browser origin, not per account, so this clears the browser's drafts/keys,
  // not just this account's — accepted at current scale (see utils/drafts).
  const onAccountDeleted = useCallback((): void => {
    resetConsent()
    queryClient.clear()
    useAIStore.getState().clearAllKeys()
    clearAllDrafts()
    useSessionExpiryStore.getState().reset()
    // Suppress the expiry dialog during the signed-out transition below.
    useSessionExpiryStore.getState().beginDeliberateLogout()
    const goToTerminalPage = (): void => {
      window.location.replace(`${window.location.origin}/account-deleted`)
    }
    // Best-effort provider sign-out, then navigate regardless of its outcome
    // (rejection OR a hang, capped by the timeout) — the navigation is the
    // guarantee, not the sign-out.
    void Promise.race([
      clerk.signOut(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).then(goToTerminalPage, goToTerminalPage)
  }, [clerk, resetConsent])

  useEffect(() => {
    if (isDevMode) return undefined
    return setupAuthInterceptor((options) => getToken(options), onAccountDeleted)
  }, [getToken, onAccountDeleted])

  return children
}

/**
 * Auth provider component that wraps the app with the Clerk context.
 * In dev mode, ClerkProvider is skipped and no authentication is required.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  // Called unconditionally (before the dev-mode branch) to satisfy the rules
  // of hooks; only used to wire Clerk's navigation into React Router below.
  const navigate = useNavigate()

  // In dev mode, skip Clerk entirely
  if (isDevMode) {
    return (
      <AuthSeamProvider status={DEV_STATUS} actions={DEV_ACTIONS}>
        {children}
      </AuthSeamProvider>
    )
  }

  return (
    <ClerkProvider
      publishableKey={config.clerk.publishableKey}
      appearance={CLERK_APPEARANCE}
      // Route Clerk-driven navigation through React Router so post-login
      // redirects are client-side transitions, not full page loads. A
      // same-location target is a no-op: the expiry dialog pins its post-
      // re-auth redirect to the current URL precisely so nothing moves, and
      // an actual navigate() there would needlessly trip the unsaved-changes
      // blocker (caught live in the M3 rehearsal). Note: these functions are
      // registered inside clerk-js once at initialization — changes here need
      // a full page reload, not just HMR.
      routerPush={(to: string) => {
        if (!isSameLocation(to)) navigate(stripOrigin(to))
      }}
      routerReplace={(to: string) => {
        if (!isSameLocation(to)) navigate(stripOrigin(to), { replace: true })
      }}
    >
      <AuthInterceptorSetup>
        <AuthSeamProviderProd>{children}</AuthSeamProviderProd>
      </AuthInterceptorSetup>
    </ClerkProvider>
  )
}
