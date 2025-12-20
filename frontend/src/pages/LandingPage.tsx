import { useAuth0 } from '@auth0/auth0-react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { BookmarkIcon } from '../components/icons'

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
 * Landing page content shown to unauthenticated users.
 */
function LandingContent({ onLogin }: { onLogin: () => void }): ReactNode {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-24 sm:px-8 lg:px-12">
        <div className="text-center">
          <div className="mb-8 flex items-center justify-center gap-4">
            <h1 className="text-7xl font-bold tracking-tight text-gray-900 sm:text-8xl">
              Tiddly
            </h1>
            <span className="mb-2 self-start rounded-full border-2 border-orange-200 bg-orange-50 px-4 py-1.5 text-sm font-semibold uppercase tracking-wide text-orange-700">
              Beta
            </span>
          </div>
          <p className="mx-auto mb-4 max-w-3xl text-2xl leading-relaxed text-gray-600">
            Your personal knowledge base. Save and organize bookmarks with powerful search,
            tags, and AI integration.
          </p>
          <p className="mx-auto mb-16 text-base text-gray-500">
            Currently in beta. Things may change as we improve the platform.
          </p>
          <button
            onClick={onLogin}
            className="rounded-full bg-gray-900 px-10 py-4 text-lg font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Get Started
          </button>
        </div>

        {/* Product Roadmap */}
        <div className="mx-auto mt-32 max-w-4xl">
          <div className="space-y-6">
            {/* Bookmarks - Available Now */}
            <div className="flex items-start gap-6 rounded-2xl bg-gray-50 p-8 transition-all hover:bg-gray-100">
              <div className="flex-shrink-0">
                <BookmarkIcon className="h-10 w-10 text-gray-900" />
              </div>
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-3xl font-bold text-gray-900">Bookmarks</h2>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
                    Available Now
                  </span>
                </div>
                <p className="mb-4 text-lg leading-relaxed text-gray-600">
                  Full-text search, flexible tagging, custom lists, and keyboard shortcuts.
                  Generate API tokens for CLI access or connect via MCP for AI-powered
                  organization.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg bg-white px-3 py-1.5 text-sm text-gray-700">
                    Full-text search
                  </span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-sm text-gray-700">
                    Tags & lists
                  </span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-sm text-gray-700">
                    API access
                  </span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-sm text-gray-700">
                    MCP integration
                  </span>
                </div>
              </div>
            </div>

            {/* Notes - Coming Soon */}
            <div className="flex items-start gap-6 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-8 opacity-60">
              <div className="flex-shrink-0">
                <svg
                  className="h-10 w-10 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-3xl font-bold text-gray-900">Notes</h2>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
                    Coming Soon
                  </span>
                </div>
                <p className="text-lg leading-relaxed text-gray-600">
                  Capture thoughts, ideas, and research. Markdown support, linking between
                  notes and bookmarks, and the same powerful search you love.
                </p>
              </div>
            </div>

            {/* Todos - Coming Soon */}
            <div className="flex items-start gap-6 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-8 opacity-60">
              <div className="flex-shrink-0">
                <svg
                  className="h-10 w-10 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-3xl font-bold text-gray-900">Todos</h2>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
                    Coming Soon
                  </span>
                </div>
                <p className="text-lg leading-relaxed text-gray-600">
                  Manage tasks and projects. Link todos to bookmarks and notes. Everything in
                  one place, organized your way.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Key Features */}
        <div className="mx-auto mt-32 max-w-4xl">
          <h2 className="mb-12 text-center text-4xl font-bold text-gray-900">
            Simple, yet powerful
          </h2>
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Search everything
              </h3>
              <p className="text-gray-600">
                Full-text search across titles, URLs, and page content. Find what you need in
                seconds, not minutes.
              </p>
            </div>
            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Keyboard-first workflow
              </h3>
              <p className="text-gray-600">
                Navigate, search, and organize efficiently with keyboard shortcuts.
                Press <kbd className="rounded bg-gray-100 px-2 py-1 text-sm">/</kbd> to start
                searching.
              </p>
            </div>
            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">API & CLI ready</h3>
              <p className="text-gray-600">
                Generate Personal Access Tokens and integrate with your tools. Automate
                bookmark creation, search from the command line, or build custom workflows.
              </p>
            </div>
            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                AI-powered with MCP
              </h3>
              <p className="text-gray-600">
                Connect Claude and other AI agents via Model Context Protocol. Let AI help you
                organize, search, and make sense of your saved content.
              </p>
            </div>
          </div>
        </div>

        {/* Final CTA */}
        <div className="mt-32 text-center">
          <h2 className="mb-6 text-4xl font-bold text-gray-900">Start organizing today</h2>
          <p className="mb-10 text-xl text-gray-600">
            Free while in beta. Pricing to be determined.
          </p>
          <button
            onClick={onLogin}
            className="rounded-full bg-gray-900 px-10 py-4 text-lg font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Landing page with Auth0 authentication (production mode).
 */
function AuthenticatedLandingPage(): ReactNode {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()

  if (isLoading) {
    return <LoadingSpinner />
  }

  // If already authenticated, redirect to bookmarks
  if (isAuthenticated) {
    return <Navigate to="/bookmarks" replace />
  }

  return <LandingContent onLogin={() => loginWithRedirect()} />
}

/**
 * Landing page component - public entry point.
 * In dev mode, redirects directly to bookmarks.
 * In production, shows login button for unauthenticated users.
 */
export function LandingPage(): ReactNode {
  // In dev mode, go straight to bookmarks
  if (isDevMode) {
    return <Navigate to="/bookmarks" replace />
  }

  return <AuthenticatedLandingPage />
}
