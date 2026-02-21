import { Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { LoadingSpinnerPage } from './ui'
import { useAuthStatus } from '../hooks/useAuthStatus'

/**
 * Error display component shown when Auth0 encounters an error.
 */
function AuthErrorDisplay({ message }: { message: string }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="alert-error max-w-md rounded-lg p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold">
          Authentication Error
        </h2>
        <p>{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="btn-danger mt-4"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}

/**
 * Protected route wrapper that requires authentication (production mode).
 */
function AuthenticatedRoute(): ReactNode {
  const { isAuthenticated, isLoading, error } = useAuthStatus()

  if (isLoading) {
    return <LoadingSpinnerPage label="Authenticating..." />
  }

  if (error) {
    return <AuthErrorDisplay message={error.message} />
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

/**
 * Protected route wrapper that requires authentication.
 * In dev mode, all access is allowed without authentication.
 */
export function ProtectedRoute(): ReactNode {
  // In dev mode, allow all access without authentication
  if (isDevMode) {
    return <Outlet />
  }

  return <AuthenticatedRoute />
}
