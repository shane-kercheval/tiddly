import type { ReactNode } from 'react'
import { AuthStatusContext, type AuthStatus } from '../hooks/useAuthStatus'

interface AuthStatusProviderProps {
  value: AuthStatus
  children: ReactNode
}

export function AuthStatusProvider({
  value,
  children,
}: AuthStatusProviderProps): ReactNode {
  return (
    <AuthStatusContext.Provider value={value}>
      {children}
    </AuthStatusContext.Provider>
  )
}
