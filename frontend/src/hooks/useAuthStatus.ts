import { createContext, useContext } from 'react'

export interface AuthStatus {
  isAuthenticated: boolean
  isLoading: boolean
  error: Error | null
  /** IdP user ID (the token's `sub` claim). Used to scope user-specific query caches. */
  userId: string | null
  /** Authenticated user's email, when the provider exposes one. Null in dev mode. */
  userEmail: string | null
}

export const AuthStatusContext = createContext<AuthStatus | null>(null)

export function useAuthStatus(): AuthStatus {
  const context = useContext(AuthStatusContext)
  if (!context) {
    throw new Error('useAuthStatus must be used within AuthProvider')
  }
  return context
}
