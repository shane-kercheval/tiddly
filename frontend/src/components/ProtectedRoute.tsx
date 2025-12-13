import { useAuth0 } from '@auth0/auth0-react'
import { Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'

/**
 * Loading spinner component shown while Auth0 is initializing.
 */
function LoadingSpinner(): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
    </div>
  )
}

/**
 * Error display component shown when Auth0 encounters an error.
 */
function ErrorDisplay({ message }: { message: string }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="rounded-lg bg-red-50 p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold text-red-800">
          Authentication Error
        </h2>
        <p className="text-red-600">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
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
  const { isAuthenticated, isLoading, error } = useAuth0()

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (error) {
    return <ErrorDisplay message={error.message} />
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
