import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Terminal screen shown after an account is deleted.
 *
 * A deleted account's still-valid token gets a terminal `account_deleted` 401
 * (see services/api.tsx and the account-deletion teardown in AuthProvider).
 * That path signs the user out, clears their local state, and lands here. This
 * is deliberately a plain, signed-out route — re-authenticating can never
 * succeed for a deleted identity, so there is no sign-in path here; the copy is
 * restrained (no data-permanence claims) and the only action is going home.
 */
export function AccountDeleted(): ReactNode {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Account deleted</h1>
        <p className="mt-3 text-gray-600">
          Your Tiddly account has been deleted. You've been signed out.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Return to homepage
        </Link>
      </div>
    </div>
  )
}
