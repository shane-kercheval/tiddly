import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { isDevMode } from '../config'
import { usePageTitle } from '../hooks/usePageTitle'
import { Footer } from '../components/Footer'
import { ChromeExtensionAnimation } from '../components/ChromeExtensionAnimation'
import { NoteMCPAnimation } from '../components/NoteMCPAnimation'
import { PromptMCPAnimation } from '../components/PromptMCPAnimation'
import { PublicHeader } from '../components/PublicHeader'
import { LoadingSpinnerPage } from '../components/ui'
import {
  BookmarkIcon,
  EditIcon,
  ExternalLinkIcon,
  HistoryIcon,
  KeyIcon,
  LinkIcon,
  ListIcon,
  PromptIcon,
  SearchIcon,
  SparklesIcon,
  TagIcon,
} from '../components/icons'

function FAQItem({
  question,
  defaultOpen = false,
  id,
  children,
}: {
  question: string
  defaultOpen?: boolean
  id?: string
  children: ReactNode
}): ReactNode {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div id={id} className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-5 text-left transition-colors hover:text-gray-600"
      >
        <h3 className="pr-4 text-lg font-semibold text-gray-900">{question}</h3>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isOpen ? 'max-h-[1000px] opacity-100 pb-5' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-3 text-[15px] leading-relaxed text-gray-500">
          {children}
        </div>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
  iconBg = 'bg-gray-100',
  comingSoon = false,
}: {
  icon: ReactNode
  title: string
  description: string
  iconBg?: string
  comingSoon?: boolean
}): ReactNode {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2.5">
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-600 ${iconBg} [&>svg]:h-3.5 [&>svg]:w-3.5`}>
          {icon}
        </div>
        <h3 className="text-base font-semibold text-gray-900">
          {title}
          {comingSoon && (
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-400">
              Coming soon
            </span>
          )}
        </h3>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{description}</p>
    </div>
  )
}

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
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-10 sm:px-8 lg:px-12">
        <div className="text-center">
          <div className="mb-4 flex items-center justify-center gap-3">
            <img src="/tiddly-logo.svg" alt="" className="h-11 w-11 sm:h-14 sm:w-14" />
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Tiddly
            </h1>
            <span className="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-600">
              Beta
            </span>
          </div>
          <p className="mx-auto mb-8 max-w-3xl text-xl leading-relaxed text-gray-500 sm:text-2xl">
            Organize your knowledge. Connect it to your AI.
          </p>
          <button
            onClick={onSignup}
            className="rounded-full bg-gray-900 px-8 py-3 text-base font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Get Started
          </button>
        </div>

        <ChromeExtensionAnimation />
        <PromptMCPAnimation />
        <NoteMCPAnimation />
      </div>

      {/* Two Pillars Side-by-Side */}
      <div className="mx-auto max-w-6xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Pillar 1: Organize your knowledge */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 lg:p-10">
            <h2 className="mb-2 flex items-center gap-2.5 text-2xl font-bold text-gray-900">
              <svg className="h-7 w-7 flex-shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" stroke="#1f2937" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
              Organize your knowledge
            </h2>
            <p className="mb-8 text-sm text-gray-500">
              Bookmarks, notes, and search — all in one place.
            </p>
            <div className="space-y-8">
              <FeatureCard
                icon={<BookmarkIcon />}
                title="Bookmarks"
                description="Save any URL and Tiddly auto-extracts the title, description, and page content. One-click saving via the Chrome extension."
              />
              <FeatureCard
                icon={<EditIcon />}
                title="Markdown notes"
                description="Write with syntax highlighting, formatting toolbar, keyboard shortcuts, and reading mode."
              />
              <FeatureCard
                icon={<HistoryIcon />}
                title="Version history"
                description="Full edit history for everything. Compare, diff, and restore — even after AI edits."
              />
              <FeatureCard
                icon={<SearchIcon />}
                title="Full-text search"
                description="Search across all content — quoted phrases, exclusions, and OR operators."
              />
              <FeatureCard
                icon={<TagIcon />}
                title="Tags, filters & collections"
                description="Organize with tags, save search filters, and group collections in the sidebar."
              />
            </div>
          </div>

          {/* Pillar 2: Connect it to your AI */}
          <div className="rounded-2xl bg-gray-50 p-8 lg:p-10">
            <h2 className="mb-2 flex items-center gap-2.5 text-2xl font-bold text-gray-900">
              <svg className="h-7 w-7 flex-shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 1C13.2 5.8 13.2 5.8 18 7C13.2 8.2 13.2 8.2 12 13C10.8 8.2 10.8 8.2 6 7C10.8 5.8 10.8 5.8 12 1Z" fill="#e2a66b"/>
                <path d="M19 12C19.7 15.1 19.7 15.1 23 16C19.7 16.7 19.7 16.7 19 20C18.3 16.7 18.3 16.7 15 16C18.3 15.1 18.3 15.1 19 12Z" fill="#6b9fd4"/>
                <path d="M7 15C7.5 17.3 7.5 17.3 10 18C7.5 18.5 7.5 18.5 7 21C6.5 18.5 6.5 18.5 4 18C6.5 17.3 6.5 17.3 7 15Z" fill="#85c48b"/>
              </svg>
              Connect it to your AI
            </h2>
            <p className="mb-8 text-sm text-gray-500">
              Build prompts, connect MCP servers, and manage content with AI.
            </p>
            <div className="space-y-8">
              <FeatureCard
                icon={<PromptIcon />}
                title="Prompt templates"
                description="Build reusable templates with Jinja2 variables and typed arguments. Version, tag, and search your prompt library."
                iconBg="bg-white"
              />
              <FeatureCard
                icon={<LinkIcon />}
                title="MCP servers"
                description="Connect your content and prompts to Claude Desktop, Claude Code, Codex, and any MCP-compatible tool."
                iconBg="bg-white"
              />
              <FeatureCard
                icon={<ExternalLinkIcon />}
                title="Agent Skills"
                description="Export prompts as slash commands for Claude Code and Codex. Write once, use across all your AI tools."
                iconBg="bg-white"
              />
              <FeatureCard
                icon={<SparklesIcon />}
                title="AI content management"
                description="AI agents search, create, and edit your bookmarks and notes via MCP — manage knowledge with natural language."
                iconBg="bg-white"
              />
              <FeatureCard
                icon={<SparklesIcon />}
                title="AI Assistant"
                description="Chat with an AI that has full context of your content."
                iconBg="bg-white"
                comingSoon
              />
            </div>
          </div>
        </div>
      </div>

      {/* Shared Foundation */}
      <div className="mx-auto max-w-5xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-12 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                <ExternalLinkIcon className="h-5 w-5 text-gray-600" />
              </div>
              <h3 className="mb-1 text-base font-semibold text-gray-900">Open source</h3>
              <p className="text-sm leading-relaxed text-gray-600">
                Self-host for full control. FastAPI, React, and PostgreSQL.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                <KeyIcon className="h-5 w-5 text-gray-600" />
              </div>
              <h3 className="mb-1 text-base font-semibold text-gray-900">REST API</h3>
              <p className="text-sm leading-relaxed text-gray-600">
                Personal Access Tokens for programmatic access to the full API.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                <ListIcon className="h-5 w-5 text-gray-600" />
              </div>
              <h3 className="mb-1 text-base font-semibold text-gray-900">Keyboard-first</h3>
              <p className="text-sm leading-relaxed text-gray-600">
                Command palette, shortcuts, and no-mouse workflows.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="mx-auto max-w-5xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-3xl font-bold text-gray-900">
            Frequently Asked Questions
          </h2>
          <div>
            <FAQItem question="How is my data stored and secured?">
              <p>
                Your data is stored in a PostgreSQL database with encryption at rest enabled by
                default. This protects against physical disk access - if someone stole the
                storage hardware, they couldn't read the data. We use Auth0 for authentication
                and implement multi-tenant architecture to ensure complete data isolation between
                users. We host on Railway's Pro tier which includes SOC 2 compliance, DDoS protection,
                automatic daily database backups, and we manually snapshot before major updates.
              </p>
              <p>
                We don't use client-side encryption (end-to-end encryption) because it would
                prevent full-text search across your content. Search functionality requires the
                server to be able to read and index your content.
              </p>
              <p>
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
              <p>
                <strong>Future AI features:</strong> In future versions, we plan to offer
                optional AI-powered features (summarization, auto-suggestions, enhanced search)
                that may send your content to third-party AI services (OpenAI, Anthropic). This
                functionality is not yet implemented and will be completely opt-in and
                configurable when available.
              </p>
            </FAQItem>

            <FAQItem question="Who can access my content?">
              <p>
                Your content is private and isolated to your account. We use a multi-tenant
                database architecture where all content is tied to your user ID. There's no
                sharing functionality. See the data security question above for important caveats.
              </p>
            </FAQItem>

            <FAQItem question="What data do you store?">
              <p>
                For bookmarks: URL, title, description, and page content (up to 500KB) for
                full-text search. Content is automatically extracted when you save a bookmark.
                For notes: title, description, and markdown content (up to 2MB). We track when
                items were created, updated, and last accessed.
              </p>
            </FAQItem>

            <FAQItem question="What happens to deleted items?">
              <p>
                Deleted items go to Trash where they can be restored. Items in trash are
                automatically permanently deleted after a retention period (currently 30 days).
                You can also manually restore or permanently delete items at any time.
              </p>
            </FAQItem>

            <FAQItem question="What are Personal Access Tokens (PATs)?">
              <p>
                PATs let you access the API programmatically for automation, CLI tools, or custom
                integrations. You can generate tokens in the Settings page. Tokens are stored
                securely (hashed) and prefixed with{' '}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">bm_</code>. Use them
                with the Authorization header to access the full REST API.
              </p>
            </FAQItem>

            <FAQItem question="What is MCP integration?">
              <p>
                MCP (Model Context Protocol) allows AI agents like Claude to interact with your
                data. Tiddly provides two MCP servers: the <strong>Content MCP Server</strong> for
                searching and managing bookmarks and notes, and the <strong>Prompt MCP Server</strong> for
                listing and rendering your prompt templates. Connect Claude Desktop, Claude Code,
                or other MCP-compatible tools. Requires a Personal Access Token for authentication.
              </p>
            </FAQItem>

            <FAQItem question="What are prompts?">
              <p>
                Prompts are reusable templates for AI assistants — a new content type for the AI era.
                They use Jinja2 syntax with variables like{' '}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">{'{{ topic }}'}</code>{' '}
                that get filled in when used. For example, you might create a "Code Review" prompt
                with variables for language, code, and focus area. AI assistants can discover and
                use your prompts via MCP, or you can export them as Agent Skills for tools like
                Claude Code and Codex. Prompts are treated as first-class entities with the same
                versioning, tagging, search, and organization as bookmarks and notes.
              </p>
            </FAQItem>

            <FAQItem question="Can I import bookmarks from my browser?">
              <p>
                Not yet. Browser bookmark import is planned. In the meantime, you can paste URLs
                into tiddly.me and metadata (title, description, page content) is automatically
                scraped, or use the REST API with a Personal Access Token to create bookmarks
                programmatically.
              </p>
            </FAQItem>

            <FAQItem question="Can I export my data?">
              <p>
                Not yet through the UI, but you can use the REST API with a Personal Access Token
                to export your content programmatically. A built-in export feature is planned.
              </p>
            </FAQItem>

            <FAQItem question="Will this always be free?">
              <p>
                Tiddly is currently free during beta as we develop features and determine the
                best pricing model. We're committed to transparency - any pricing changes will be
                announced well in advance, and existing users may be grandfathered or given ample
                notice.
              </p>
            </FAQItem>

            <FAQItem question="Can I self-host Tiddly?" id="self-host">
              <p>
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
            </FAQItem>
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div className="mx-auto max-w-5xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="rounded-2xl bg-gray-50 px-8 py-16 text-center">
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
