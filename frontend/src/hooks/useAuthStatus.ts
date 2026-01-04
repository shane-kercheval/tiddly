import { createContext, useContext } from 'react'

export interface AuthStatus {
  isAuthenticated: boolean
  isLoading: boolean
}

export const AuthStatusContext = createContext<AuthStatus | null>(null)

export function useAuthStatus(): AuthStatus {
  const context = useContext(AuthStatusContext)
  if (!context) {
    throw new Error('useAuthStatus must be used within AuthStatusProvider')
  }
  return context
}
