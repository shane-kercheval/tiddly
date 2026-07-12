import { Auth0Provider, useAuth0, type AppState } from '@auth0/auth0-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { config, isDevMode } from '../config'
import { setupAuthInterceptor } from '../services/api'
import { useConsentStore } from '../stores/consentStore'
import { queryClient } from '../queryClient'
import { toSafeReturnTo } from '../utils/returnTo'
import { AuthSeamProvider } from './AuthSeamProvider'
import type { AuthActions } from '../hooks/useAuthActions'

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

/**
 * Bridges the provider SDK onto the seam: status (isAuthenticated/loading/
 * error/userId/userEmail) and actions (login/logout). This component is the
 * only place SDK hooks are read for seam purposes — call sites consume
 * useAuthStatus()/useAuthActions() and never the SDK (lint-enforced).
 */
function AuthSeamProviderProd({ children }: AuthProviderProps): ReactNode {
  const { isAuthenticated, isLoading, error, user, loginWithRedirect, logout } = useAuth0()

  const actions = useMemo<AuthActions>(
    () => ({
      login: ({ mode = 'login', returnTo } = {}) => {
        void loginWithRedirect({
          ...(returnTo ? { appState: { returnTo } } : {}),
          authorizationParams: { screen_hint: mode },
        })
      },
      logout: () => {
        void logout({ logoutParams: { returnTo: window.location.origin } })
      },
    }),
    [loginWithRedirect, logout],
  )

  return (
    <AuthSeamProvider
      status={{
        isAuthenticated,
        isLoading,
        error: error ?? null,
        userId: user?.sub ?? null,
        userEmail: user?.email ?? null,
      }}
      actions={actions}
    >
      {children}
    </AuthSeamProvider>
  )
}

/**
 * Inner component that sets up the API interceptors once Auth0 is available.
 */
function AuthInterceptorSetup({ children }: AuthProviderProps): ReactNode {
  const { getAccessTokenSilently, logout } = useAuth0()
  const resetConsent = useConsentStore((state) => state.reset)

  useEffect(() => {
    if (!isDevMode) {
      setupAuthInterceptor(
        (options) => getAccessTokenSilently(options),
        () => {
          resetConsent()
          queryClient.clear()
          logout({ logoutParams: { returnTo: window.location.origin } })
        }
      )
    }
  }, [getAccessTokenSilently, logout, resetConsent])

  return children
}

/**
 * Auth provider component that wraps the app with Auth0 context.
 * In dev mode, Auth0Provider is skipped and no authentication is required.
 *
 * IMPORTANT - Refresh Token Configuration:
 * The `offline_access` scope is required for Auth0 to issue refresh tokens.
 * Without it, users are logged out when the access token expires (~24 hours),
 * even with `useRefreshTokens={true}` set. Both are required:
 *   1. `scope: 'offline_access'` here in the frontend
 *   2. "Allow Offline Access" enabled in Auth0 API settings (see README_DEPLOY.md)
 *
 * The options passthrough in AuthInterceptorSetup allows the API interceptor
 * to call `getAccessTokenSilently({ cacheMode: 'off' })` when retrying after
 * a 401, forcing a fresh token fetch instead of using a cached expired token.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  // Called unconditionally (before the dev-mode branch) to satisfy the rules of
  // hooks; only used by the Auth0 redirect callback below in production.
  const navigate = useNavigate()

  // In dev mode, skip Auth0 entirely
  if (isDevMode) {
    return (
      <AuthSeamProvider status={DEV_STATUS} actions={DEV_ACTIONS}>
        {children}
      </AuthSeamProvider>
    )
  }

  // After Auth0 completes a login redirect, return the user to where they
  // started (e.g. the shared URL a logged-out visitor signed in from). The
  // target is sanitized to a same-origin relative path to avoid open redirects;
  // absent/invalid values fall back to the app root, preserving prior behavior.
  const handleRedirectCallback = (appState?: AppState): void => {
    navigate(toSafeReturnTo(appState?.returnTo))
  }

  return (
    <Auth0Provider
      domain={config.auth0.domain}
      clientId={config.auth0.clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: config.auth0.audience,
        scope: 'openid profile email offline_access',
      }}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      onRedirectCallback={handleRedirectCallback}
    >
      <AuthInterceptorSetup>
        <AuthSeamProviderProd>{children}</AuthSeamProviderProd>
      </AuthInterceptorSetup>
    </Auth0Provider>
  )
}
