import type { ReactNode } from 'react'
import { AuthStatusContext, type AuthStatus } from '../hooks/useAuthStatus'
import { AuthActionsContext, type AuthActions } from '../hooks/useAuthActions'

interface AuthSeamProviderProps {
  status: AuthStatus
  actions: AuthActions
  children: ReactNode
}

/**
 * Provides both halves of the auth seam (status + actions) on separate
 * contexts, so action-only consumers (login/signup buttons) don't re-render
 * on auth-status transitions.
 */
export function AuthSeamProvider({
  status,
  actions,
  children,
}: AuthSeamProviderProps): ReactNode {
  return (
    <AuthStatusContext.Provider value={status}>
      <AuthActionsContext.Provider value={actions}>
        {children}
      </AuthActionsContext.Provider>
    </AuthStatusContext.Provider>
  )
}
