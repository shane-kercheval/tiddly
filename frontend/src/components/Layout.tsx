import { useAuth0 } from '@auth0/auth0-react'
import { Outlet, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'

/**
 * Dev mode banner shown when running without Auth0 configuration.
 */
function DevModeBanner(): ReactNode {
  return (
    <div className="bg-yellow-100 px-4 py-1 text-center text-sm text-yellow-800">
      Dev Mode - Authentication disabled
    </div>
  )
}

/**
 * User controls shown in dev mode (no authentication).
 */
function DevModeUserControls(): ReactNode {
  return (
    <span className="badge bg-yellow-100 text-yellow-800">
      Dev User
    </span>
  )
}

/**
 * User controls shown when authenticated via Auth0.
 */
function AuthenticatedUserControls(): ReactNode {
  const { user, logout } = useAuth0()

  return (
    <>
      <span className="text-sm text-gray-600">{user?.email}</span>
      <button
        onClick={() =>
          logout({ logoutParams: { returnTo: window.location.origin } })
        }
        className="btn-ghost"
      >
        Log out
      </button>
    </>
  )
}

/**
 * Header component with navigation and user controls.
 */
function Header(): ReactNode {
  return (
    <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link to="/bookmarks" className="text-lg font-semibold text-gray-900">
          Bookmarks
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            to="/settings"
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Settings"
            aria-label="Settings"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
          </Link>
          {isDevMode ? <DevModeUserControls /> : <AuthenticatedUserControls />}
        </nav>
      </div>
    </header>
  )
}

/**
 * Layout component that wraps authenticated pages.
 * Includes header with navigation and logout functionality.
 */
export function Layout(): ReactNode {
  return (
    <div className="min-h-screen bg-white">
      {isDevMode && <DevModeBanner />}
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
