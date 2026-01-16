import { useAuth0 } from '@auth0/auth0-react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { BookmarkIcon } from '../components/icons'
import { Footer } from '../components/Footer'
import { LoadingSpinnerCentered } from '../components/ui'

/**
 * Landing page content shown to unauthenticated users.
 */
function LandingContent({ onLogin }: { onLogin: () => void }): ReactNode {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-8 lg:px-12">
        <BookmarkIcon className="h-8 w-8 text-gray-900" />
        <button
          onClick={onLogin}
          className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
        >
          Log In
        </button>
      </header>

      {/* Hero Section */}
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-12 sm:px-8 lg:px-12">
        <div className="text-center">
          <div className="mb-8 flex items-center justify-center gap-4">
            <h1 className="text-6xl font-bold tracking-tight text-gray-900 sm:text-7xl">
              Tiddly
            </h1>
            <span className="mb-2 self-start rounded-full border-2 border-orange-200 bg-orange-50 px-4 py-1.5 text-sm font-semibold uppercase tracking-wide text-orange-700">
              Beta
            </span>
          </div>
          <p className="mx-auto mb-4 max-w-3xl text-2xl leading-relaxed text-gray-600">
            A simple, AI-integrated personal knowledge base.
          </p>
          <p className="mx-auto mb-16 text-base text-gray-500">
            Currently in beta.
          </p>
          <button
            onClick={onLogin}
            className="rounded-full bg-gray-900 px-10 py-4 text-lg font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Get Started
          </button>
        </div>

        {/* Content Types */}
        <div className="mx-auto mt-24 max-w-3xl">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-lg">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Bookmarks</span>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Notes</span>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Prompts</span>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Tasks</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                Coming soon
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">AI Assistant</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                Coming soon
              </span>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mx-auto mt-24 max-w-4xl">
          <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Markdown editor</h3>
              <p className="text-gray-600">
                Write notes with markdown syntax highlighting, formatting toolbar, and keyboard
                shortcuts. Toggle reading mode to preview rendered markdown.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Prompt templates</h3>
              <p className="text-gray-600">
                Create reusable prompt templates with Jinja2 syntax. Define arguments for
                dynamic content. Organize and tag prompts for easy access.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Prompt MCP Server</h3>
              <p className="text-gray-600">
                Expose your prompts to Claude Desktop, Claude Code, or any MCP-compatible AI agent.
                List, render, and create prompts through natural language.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Content MCP Server</h3>
              <p className="text-gray-600">
                Connect AI agents to search and manage your bookmarks and notes. Create content
                using natural language through Model Context Protocol.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">API access</h3>
              <p className="text-gray-600">
                Generate Personal Access Tokens for programmatic access. Search, create, and
                manage content from scripts or CLI tools.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Open source</h3>
              <p className="text-gray-600">
                Use the hosted version by signing up above, or self-host for full control
                over your data. Open source with PostgreSQL backend.
              </p>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mx-auto mt-32 max-w-4xl">
          <h2 className="mb-12 text-center text-4xl font-bold text-gray-900">
            Frequently Asked Questions
          </h2>
          <div className="space-y-8">
            {/* FAQ Item */}
            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                How is my data stored and secured?
              </h3>
              <p className="mb-3 text-gray-600">
                Your data is stored in a PostgreSQL database with encryption at rest enabled by
                default. This protects against physical disk access - if someone stole the
                storage hardware, they couldn't read the data. We use Auth0 for authentication
                and implement multi-tenant architecture to ensure complete data isolation between
                users.
              </p>
              <p className="mb-3 text-gray-600">
                We don't use client-side encryption (end-to-end encryption) because it would
                prevent full-text search across your bookmarks, notes, prompts, and tasks. Search
                functionality requires the server to be able to read and index your content.
              </p>
              <p className="mb-3 text-gray-600">
                <strong>Important:</strong> As with most web applications, the database
                administrator (me) could technically access your data through normal database
                queries. Encryption at rest doesn't prevent admin access. I have no intention of
                accessing user data and will never do so unless legally required. If you need
                complete privacy where no one else can read your data, consider{' '}
                <a href="#self-host" className="text-blue-600 hover:underline">
                  self-hosting
                </a>
                .
              </p>
              <p className="text-gray-600">
                <strong>Future AI features:</strong> In future versions, we plan to offer
                optional AI-powered features (summarization, auto-suggestions, enhanced search)
                that may send your content to third-party AI services (OpenAI, Anthropic). This
                functionality is not yet implemented and will be completely opt-in and
                configurable when available.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Who can access my content?
              </h3>
              <p className="text-gray-600">
                Only you. Your bookmarks and notes are completely private and isolated to your
                account. We use a multi-tenant database architecture where all content is tied
                to your user ID. There's no sharing functionality - your data is yours alone.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                What data do you store?
              </h3>
              <p className="text-gray-600">
                For bookmarks: URL, title, description, and page content (up to 500KB) for
                full-text search. Content is automatically extracted when you save a bookmark.
                For notes: title, description, and markdown content (up to 2MB). We track when
                items were created, updated, and last accessed.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                What happens to deleted items?
              </h3>
              <p className="text-gray-600">
                Deleted bookmarks and notes go to Trash where they can be restored. Items remain
                in trash until you manually restore or permanently delete them.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                What are Personal Access Tokens (PATs)?
              </h3>
              <p className="text-gray-600">
                PATs let you access the API programmatically for automation, CLI tools, or custom
                integrations. You can generate tokens in the Settings page. Tokens are stored
                securely (hashed) and prefixed with{' '}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">bm_</code>. Use them
                with the Authorization header to access the full REST API.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                What is MCP integration?
              </h3>
              <p className="text-gray-600">
                MCP (Model Context Protocol) allows AI agents like Claude to interact with your
                data. Tiddly provides two MCP servers: the <strong>Content MCP Server</strong> for
                searching and managing bookmarks and notes, and the <strong>Prompt MCP Server</strong> for
                listing and rendering your prompt templates. Connect Claude Desktop, Claude Code,
                or other MCP-compatible tools. Requires a Personal Access Token for authentication.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Can I export my data?
              </h3>
              <p className="text-gray-600">
                Not yet through the UI, but you can use the REST API with a Personal Access Token
                to export your content programmatically. A built-in export feature is planned.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Will this always be free?
              </h3>
              <p className="text-gray-600">
                Tiddly is currently free during beta as we develop features and determine the
                best pricing model. We're committed to transparency - any pricing changes will be
                announced well in advance, and existing users may be grandfathered or given ample
                notice.
              </p>
            </div>

            <div id="self-host">
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Can I self-host Tiddly?
              </h3>
              <p className="text-gray-600">
                Yes! The{' '}
                <a
                  href="https://github.com/shane-kercheval/bookmarks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  codebase is available
                </a>{' '}
                and can be self-hosted. You'll need PostgreSQL, and optionally Auth0 for
                authentication (or use dev mode to bypass auth). Full deployment instructions are
                included in the repository. Self-hosting gives you complete control over your data.
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
      <Footer />
    </div>
  )
}

/**
 * Landing page with Auth0 authentication (production mode).
 */
function AuthenticatedLandingPage(): ReactNode {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0()

  if (isLoading) {
    return <LoadingSpinnerCentered />
  }

  // If already authenticated, redirect to app
  if (isAuthenticated) {
    return <Navigate to="/app/content" replace />
  }

  return <LandingContent onLogin={() => loginWithRedirect()} />
}

/**
 * Landing page component - public entry point.
 * In dev mode, redirects directly to app.
 * In production, shows login button for unauthenticated users.
 */
export function LandingPage(): ReactNode {
  // In dev mode, go straight to app
  if (isDevMode) {
    return <Navigate to="/app/content" replace />
  }

  return <AuthenticatedLandingPage />
}
