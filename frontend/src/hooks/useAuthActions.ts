import { createContext, useContext } from 'react'

export interface LoginOptions {
  /** Which screen the provider opens first. Defaults to 'login'. */
  mode?: 'login' | 'signup'
  /**
   * Same-origin path to return the user to after login completes. Sanitized
   * in AuthProvider (toSafeReturnTo) before navigation; omit to land on the
   * app root.
   */
  returnTo?: string
}

/**
 * Auth actions carried through the provider seam. Components call these
 * instead of the auth-provider SDK, so a provider swap touches only
 * AuthProvider.tsx (enforced by the no-restricted-imports lint rule).
 */
export interface AuthActions {
  login: (options?: LoginOptions) => void
  logout: () => void
}

export const AuthActionsContext = createContext<AuthActions | null>(null)

export function useAuthActions(): AuthActions {
  const context = useContext(AuthActionsContext)
  if (!context) {
    throw new Error('useAuthActions must be used within AuthProvider')
  }
  return context
}
