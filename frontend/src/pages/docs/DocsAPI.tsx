import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'
import { config } from '../../config'

export function DocsAPI(): ReactNode {
  usePageTitle('Docs - API')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">API</h1>
      <p className="text-sm text-gray-600 mb-8">
        Access your bookmarks, notes, and prompts programmatically. The REST API supports
        everything the web app does — create, read, update, search, tag, and manage version
        history for all content types.
      </p>

      {/* Authentication */}
      <h2 className="text-lg font-bold text-gray-900 mb-3">Authentication</h2>
      <p className="text-sm text-gray-600 mb-3">
        All API requests require a Personal Access Token (PAT) passed as a Bearer token:
      </p>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 mb-4">
        <code className="text-sm text-gray-700">Authorization: Bearer bm_your_token_here</code>
      </div>
      <p className="text-sm text-gray-600 mb-3">
        Create a token in{' '}
        <a href="/app/settings/tokens" className="text-[#d97b3d] hover:underline">
          Settings &rarr; Personal Access Tokens
        </a>
        . Tokens are shown only once when created, so store them securely. You can also
        create tokens via the{' '}
        <Link to="/docs/cli/reference" className="text-[#d97b3d] hover:underline">CLI</Link>.
      </p>
      <InfoCallout variant="warning">
        Treat tokens like passwords. Never commit them to version control or expose them in
        client-side code.
      </InfoCallout>

      {/* Endpoint Groups */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-3">Endpoints</h2>
      <p className="text-sm text-gray-600 mb-4">
        The API is organized around content types, with shared capabilities across all of them:
      </p>

      <div className="space-y-3 mb-6">
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Bookmarks</h3>
          <p className="text-sm text-gray-600">
            CRUD operations, URL-based duplicate detection, and automatic metadata scraping
            when creating from a URL.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Notes</h3>
          <p className="text-sm text-gray-600">
            CRUD operations for markdown notes with title, description, content, and tags.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Prompts</h3>
          <p className="text-sm text-gray-600">
            CRUD operations for Jinja2 prompt templates, plus a render endpoint that substitutes
            argument values into the template.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Content (Unified Search)</h3>
          <p className="text-sm text-gray-600">
            Search across all content types at once with full-text search, substring matching,
            tag filtering, and in-content search within a single item.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Tags</h3>
          <p className="text-sm text-gray-600">
            List all tags with usage counts, rename tags globally, and delete tags across all content.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">History</h3>
          <p className="text-sm text-gray-600">
            View version history for any item, compare versions with diffs, and restore to a
            previous version.
          </p>
        </div>
      </div>

      {/* Shared Capabilities */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-3">Shared Capabilities</h2>
      <ul className="space-y-1.5 text-sm text-gray-600 mb-6">
        <li><strong>Pagination</strong> — all list endpoints support offset/limit pagination</li>
        <li><strong>Sorting</strong> — sort by created date, updated date, title, or last used</li>
        <li><strong>Tag filtering</strong> — filter by tags with AND/OR matching</li>
        <li><strong>Optimistic locking</strong> — pass <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">If-Unmodified-Since</code> to detect concurrent edits</li>
        <li><strong>Archive &amp; trash</strong> — soft-delete and archive operations with recovery</li>
        <li><strong>Relationships</strong> — link any item to any other item across content types</li>
      </ul>

      {/* Swagger Docs */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-3">Interactive Docs</h2>
      <p className="text-sm text-gray-600 mb-4">
        The full API reference with request/response schemas and a &quot;Try it out&quot; feature is
        available via Swagger:
      </p>
      <a
        href={`${config.apiUrl}/docs`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary inline-flex items-center gap-2"
      >
        Open API Docs
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>

      {/* Rate Limits */}
      <h2 className="text-lg font-bold text-gray-900 mt-10 mb-3">Rate Limits</h2>
      <p className="text-sm text-gray-600 mb-4">
        API requests are rate-limited per account. Current limits are shown in{' '}
        <a href="/app/settings" className="text-[#d97b3d] hover:underline">
          Settings &rarr; General
        </a>
        . Rate limit headers (<code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">X-RateLimit-Remaining</code>)
        are included in every response.
      </p>

      <InfoCallout variant="tip" title="MCP Integration">
        <p>
          If you want AI assistants to access your content, consider using the{' '}
          <Link to="/docs/ai" className="underline hover:text-gray-900">MCP servers</Link>{' '}
          instead of the raw API — they handle authentication, pagination, and tool definitions
          automatically.
        </p>
      </InfoCallout>
    </div>
  )
}
