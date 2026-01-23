import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { useEffect, type ReactNode } from 'react'
import { config, isDevMode } from '../config'
import { setupAuthInterceptor } from '../services/api'
import { useConsentStore } from '../stores/consentStore'
import { queryClient } from '../queryClient'
import { AuthStatusProvider } from './AuthStatusProvider'

interface AuthProviderProps {
  children: ReactNode
}

function AuthStatusProviderDev({ children }: AuthProviderProps): ReactNode {
  return (
    <AuthStatusProvider value={{ isAuthenticated: true, isLoading: false, error: null }}>
      {children}
    </AuthStatusProvider>
  )
}

function AuthStatusProviderProd({ children }: AuthProviderProps): ReactNode {
  const { isAuthenticated, isLoading, error } = useAuth0()
  return (
    <AuthStatusProvider value={{ isAuthenticated, isLoading, error: error ?? null }}>
      {children}
    </AuthStatusProvider>
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
  // In dev mode, skip Auth0 entirely
  if (isDevMode) {
    return <AuthStatusProviderDev>{children}</AuthStatusProviderDev>
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
    >
      <AuthInterceptorSetup>
        <AuthStatusProviderProd>{children}</AuthStatusProviderProd>
      </AuthInterceptorSetup>
    </Auth0Provider>
  )
}
