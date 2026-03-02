import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { PublicHeader } from '../components/PublicHeader'
import { Footer } from '../components/Footer'
import { PromptMCPAnimation } from '../components/PromptMCPAnimation'
import { NoteMCPAnimation } from '../components/NoteMCPAnimation'
import { ChromeExtensionAnimation } from '../components/ChromeExtensionAnimation'
import { VersionHistoryAnimation } from '../components/VersionHistoryAnimation'
import {
  SparklesIcon,
  TagIcon,
  SearchIcon,
  EditIcon,
  ExternalLinkIcon,
  KeyIcon,
  ListIcon,
  LinkIcon,
} from '../components/icons'

/** Remounts an animation component after it completes, creating an auto-replay loop. */
function ReplayableAnimation({
  Component,
  restartDelay = 1500,
}: {
  Component: ComponentType<{ onComplete?: () => void }>
  restartDelay?: number
}): ReactNode {
  const [key, setKey] = useState(0)

  const handleComplete = useCallback((): void => {
    setTimeout(() => setKey((k) => k + 1), restartDelay)
  }, [restartDelay])

  return <Component key={key} onComplete={handleComplete} />
}

function CompactCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}): ReactNode {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
      <div className="mb-2 flex items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </div>
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
      </div>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  )
}

function DevCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}): ReactNode {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-gray-600">{description}</p>
    </div>
  )
}

function FeaturesContent({
  onLogin,
  onSignup,
}: {
  onLogin: () => void
  onSignup: () => void
}): ReactNode {
  usePageTitle('Features')

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader onLogin={onLogin} onSignup={onSignup} />

      {/* 1. Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-12 pt-16 text-center sm:px-8 lg:px-12">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          Features
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
          Features for modern content management.
        </p>
      </section>

      {/* 2. AI Integration */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-5xl px-6 sm:px-8 lg:px-12">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Connect your knowledge to AI</h2>
            <p className="mt-3 text-gray-600">
              Two MCP servers let AI assistants discover, use, and manage your content through natural language.
            </p>
          </div>

          {/* Prompt Templates & MCP */}
          <div className="mb-16">
            <div className="mb-6 text-center">
              <h3 className="text-xl font-semibold text-gray-900">Prompt Templates &amp; MCP</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-600">
                Build Jinja2 templates with variables and typed arguments. AI agents discover and use them
                via the Prompt MCP Server. Supported in Claude Desktop, Claude Code, Codex, and any MCP-compatible tool.
              </p>
            </div>
            <ReplayableAnimation Component={PromptMCPAnimation} />
          </div>

          {/* AI Content Management */}
          <div className="mb-16">
            <div className="mb-6 text-center">
              <h3 className="text-xl font-semibold text-gray-900">AI Content Management</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-600">
                AI agents search, read, create, and edit your bookmarks and notes through natural language
                via the Content MCP Server.
              </p>
            </div>
            <ReplayableAnimation Component={NoteMCPAnimation} />
          </div>

          {/* Additional AI features */}
          <div className="grid gap-4 sm:grid-cols-2">
            <CompactCard
              icon={<SparklesIcon />}
              title="Agent Skills"
              description="Export prompts as SKILL.md instruction files that AI agents can load and follow."
            />
            <CompactCard
              icon={<LinkIcon />}
              title="Two MCP Servers"
              description="Content Server for bookmarks & notes, Prompt Server for templates — separate concerns, flexible setup."
            />
          </div>
        </div>
      </section>

      {/* 3. Version History */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6 sm:px-8 lg:px-12">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Every change, tracked and reversible</h2>
            <p className="mt-3 text-gray-600">
              Full version history for all content — bookmarks, notes, and prompts.
            </p>
          </div>
          <ReplayableAnimation Component={VersionHistoryAnimation} />
        </div>
      </section>

      {/* 4. Organization & Search */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-4xl px-6 sm:px-8 lg:px-12">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Find and organize everything</h2>
          </div>

          <div className="grid gap-12 lg:grid-cols-2">
            {/* Organization */}
            <div>
              <h3 className="mb-4 text-xl font-semibold text-gray-900">Organization</h3>
              <ul className="space-y-4 text-sm text-gray-600">
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <TagIcon />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Tags</span> — Global across all content types. Rename or delete from one place.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <ListIcon />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Saved Filters</span> — Boolean tag expressions with AND/OR logic. Save and reuse across sessions.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <LinkIcon />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Relationships</span> — Cross-link any items to build connections between related content.
                  </div>
                </li>
              </ul>
            </div>

            {/* Search */}
            <div>
              <h3 className="mb-4 text-xl font-semibold text-gray-900">Search</h3>
              <ul className="space-y-4 text-sm text-gray-600">
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <SearchIcon />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Full-text search</span> — Search across titles, descriptions, tags, and content of all items.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <EditIcon />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Search operators</span> — Use <code className="rounded bg-white px-1 py-0.5 text-xs">"exact phrase"</code>, <code className="rounded bg-white px-1 py-0.5 text-xs">-exclude</code>, and <code className="rounded bg-white px-1 py-0.5 text-xs">OR</code> to refine results.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                    <SearchIcon />
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">In-content search</span> — Search within a document with regex support.
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Chrome Extension */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6 sm:px-8 lg:px-12">
          <div className="mb-6 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Save from anywhere</h2>
            <p className="mt-3 text-gray-600">
              The Chrome extension lets you save bookmarks without leaving the page.
            </p>
          </div>
          <ReplayableAnimation Component={ChromeExtensionAnimation} />
          <ul className="mx-auto mt-8 grid max-w-2xl gap-3 text-sm text-gray-600 sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              Auto-scrape title, description, and metadata
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              Tag pre-selection from your existing tags
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              Captures page content for full-text search
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
              Works on any page — articles, docs, tools, anything
            </li>
          </ul>
        </div>
      </section>

      {/* 6. Developer & Power User */}
      <section className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-gray-900">Built for developers</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <DevCard
              icon={<KeyIcon />}
              title="REST API"
              description="Full API with Personal Access Tokens (PATs). Build automation, CLI tools, and custom integrations."
            />
            <DevCard
              icon={<ListIcon />}
              title="Keyboard-first"
              description="Command palette (Cmd+Shift+P), 20+ shortcuts, slash commands in the editor. No-mouse workflows."
            />
            <DevCard
              icon={<ExternalLinkIcon />}
              title="Open source"
              description="Self-host with FastAPI, React, and PostgreSQL. Full control over your data."
            />
          </div>
        </div>
      </section>

      {/* 7. CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="rounded-2xl bg-gray-50 px-8 py-16 text-center">
          <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Start organizing today
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-gray-600">
            Save bookmarks, write notes, build prompt templates, and connect everything to your AI workflow.
          </p>
          <button
            onClick={() => onSignup()}
            className="mt-8 inline-block rounded-full bg-gray-900 px-8 py-3 text-sm font-medium text-white transition-all hover:bg-gray-700 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
          >
            Get Started
          </button>
        </div>
      </section>

      <Footer />
    </div>
  )
}

export function FeaturesPage(): ReactNode {
  usePageTitle('Features')
  const { loginWithRedirect } = useAuth0()

  const handleLogin = (): void => {
    loginWithRedirect()
  }

  const handleSignup = (): void => {
    loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })
  }

  return <FeaturesContent onLogin={handleLogin} onSignup={handleSignup} />
}
