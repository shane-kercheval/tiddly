import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { useEffect, type ReactNode } from 'react'
import { config, isDevMode } from '../config'
import { setupAuthInterceptor } from '../services/api'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Inner component that sets up the API interceptors once Auth0 is available.
 */
function AuthInterceptorSetup({ children }: AuthProviderProps): ReactNode {
  const { getAccessTokenSilently, logout } = useAuth0()

  useEffect(() => {
    if (!isDevMode) {
      setupAuthInterceptor(
        () => getAccessTokenSilently(),
        () => logout({ logoutParams: { returnTo: window.location.origin } })
      )
    }
  }, [getAccessTokenSilently, logout])

  return children
}

/**
 * Auth provider component that wraps the app with Auth0 context.
 * In dev mode, Auth0Provider is skipped and no authentication is required.
 */
export function AuthProvider({ children }: AuthProviderProps): ReactNode {
  // In dev mode, skip Auth0 entirely
  if (isDevMode) {
    return children
  }

  return (
    <Auth0Provider
      domain={config.auth0.domain}
      clientId={config.auth0.clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: config.auth0.audience,
      }}
    >
      <AuthInterceptorSetup>{children}</AuthInterceptorSetup>
    </Auth0Provider>
  )
}
