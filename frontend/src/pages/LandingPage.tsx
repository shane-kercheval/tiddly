import { useAuth0 } from '@auth0/auth0-react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { usePageTitle } from '../hooks/usePageTitle'
import { Footer } from '../components/Footer'
import { PublicHeader } from '../components/PublicHeader'
import { LoadingSpinnerPage } from '../components/ui'

/**
 * Landing page content shown to unauthenticated users.
 */
function LandingContent({
  onLogin,
  onSignup,
}: {
  onLogin: () => void
  onSignup: () => void
}): ReactNode {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader onLogin={onLogin} onSignup={onSignup} />

      {/* Hero Section */}
      <div className="mx-auto max-w-5xl px-6 pb-24 pt-12 sm:px-8 lg:px-12">
        <div className="text-center">
          <div className="mb-6 flex items-center justify-center gap-4">
            <img src="/tiddly-logo.svg" alt="" className="h-16 w-16 sm:h-20 sm:w-20" />
            <h1 className="text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl lg:text-7xl">
              Tiddly
            </h1>
            <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-orange-600">
              Beta
            </span>
          </div>
          <p className="mx-auto mb-8 max-w-3xl text-xl leading-relaxed text-gray-500 sm:text-2xl">
            A simple, AI-integrated personal knowledge base.
          </p>
          <button
            onClick={onSignup}
            className="rounded-full bg-gray-900 px-10 py-4 text-lg font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Get Started
          </button>
        </div>

        {/* Content Types */}
        <div className="mx-auto mt-10 max-w-3xl">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-base">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Notes</span>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600">
                Available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Prompts</span>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600">
                Available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Bookmarks</span>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600">
                Available
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-400">AI Assistant</span>
              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-400">
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
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Content MCP Server</h3>
              <p className="text-gray-600">
                Connect AI agents to search and manage your bookmarks and notes. Create content
                using natural language through Model Context Protocol.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Prompt library</h3>
              <p className="text-gray-600">
                Build your personal prompt library. Create reusable templates with Jinja2 syntax
                and dynamic arguments. Organize with tags for easy discovery.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Prompt MCP Server</h3>
              <p className="text-gray-600">
                Expose your prompt library to Claude Desktop, Claude Code, or any MCP-compatible
                AI agent. Your prompts follow you across tools - write once, use everywhere.
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Version history</h3>
              <p className="text-gray-600">
                Full edit history for all content. Compare versions, see what changed, and
                restore with one click. Your work is never lost - even when AI agents make updates.
              </p>
            </div>
            {/* <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">API access</h3>
              <p className="text-gray-600">
                Generate Personal Access Tokens for programmatic access. Search, create, and
                manage content from scripts or CLI tools.
              </p>
            </div> */}
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Open source</h3>
              <p className="text-gray-600">
                Use the hosted version by signing up above, or self-host for full control
                over your data. Open source with FastAPI backend, React frontend, and PostgreSQL database.
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
                users. We host on Railway's Pro tier which includes SOC 2 compliance, DDoS protection,
                automatic daily database backups, and we manually snapshot before major updates.
              </p>
              <p className="mb-3 text-gray-600">
                We don't use client-side encryption (end-to-end encryption) because it would
                prevent full-text search across your content. Search functionality requires the
                server to be able to read and index your content.
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
                Your content is private and isolated to your account. We use a multi-tenant
                database architecture where all content is tied to your user ID. There's no
                sharing functionality. See the data security question above for important caveats.
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
                Deleted items go to Trash where they can be restored. Items in trash are
                automatically permanently deleted after a retention period (currently 30 days).
                You can also manually restore or permanently delete items at any time.
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
                What are prompts?
              </h3>
              <p className="text-gray-600">
                Prompts are reusable templates for AI assistants — a new content type for the AI era.
                They use Jinja2 syntax with variables like{' '}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">{'{{ topic }}'}</code>{' '}
                that get filled in when used. For example, you might create a "Code Review" prompt
                with variables for language, code, and focus area. AI assistants can discover and
                use your prompts via MCP, or you can export them as Agent Skills for tools like
                Claude Code and Codex. Prompts are treated as first-class entities with the same
                versioning, tagging, search, and organization as bookmarks and notes.
              </p>
            </div>

            <div>
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                Can I import bookmarks from my browser?
              </h3>
              <p className="text-gray-600">
                Not yet. Browser bookmark import is planned. In the meantime, you can paste URLs
                into tiddly.me and metadata (title, description, page content) is automatically
                scraped, or use the REST API with a Personal Access Token to create bookmarks
                programmatically.
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
                  href="https://github.com/shane-kercheval/tiddly"
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
        <div className="mt-32 rounded-2xl bg-gray-50 px-8 py-16 text-center">
          <h2 className="mb-6 text-3xl font-bold text-gray-900">Start organizing today</h2>
          <p className="mb-10 text-lg text-gray-500">
            Free while in beta. Pricing to be determined.
          </p>
          <button
            onClick={onSignup}
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
  usePageTitle(undefined)

  if (isLoading) {
    return <LoadingSpinnerPage />
  }

  // If already authenticated, redirect to app
  if (isAuthenticated) {
    return <Navigate to="/app/content" replace />
  }

  return (
    <LandingContent
      onLogin={() => loginWithRedirect({ authorizationParams: { screen_hint: 'login' } })}
      onSignup={() => loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })}
    />
  )
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
