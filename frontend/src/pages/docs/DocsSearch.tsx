import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'

export function DocsSearch(): ReactNode {
  usePageTitle('Docs - Search')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Search</h1>
      <p className="text-gray-600 mb-10">
        Search across all your bookmarks, notes, and prompts. Tiddly uses a two-tier search
        system combining full-text search with substring matching for comprehensive results.
      </p>

      {/* Quick Access */}
      <h2 className="text-xl font-bold text-gray-900 mb-3">Quick Access</h2>
      <ul className="space-y-2 text-gray-600">
        <li>
          <strong>Search bar</strong> — press{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">/</code> to focus the
          search bar and start typing
        </li>
        <li>
          <strong>Command palette</strong> — press{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+Shift+P</code> for
          quick search and navigation across all content
        </li>
      </ul>

      {/* How Search Works */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">How Search Works</h2>
        <p className="text-gray-600 mb-3">
          When you type a query, Tiddly runs two search strategies in parallel and combines the
          results:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-gray-600 mb-4">
          <li>
            <strong>Full-text search</strong> — stemmed matching (e.g. &quot;running&quot; matches
            &quot;run&quot;) with relevance ranking
          </li>
          <li>
            <strong>Substring matching</strong> — exact substring match for partial words, code
            symbols, and terms that stemming misses
          </li>
        </ol>
        <p className="text-gray-600">
          Results are ranked by a combined relevance score weighted by field: title matches
          rank highest, then description, then content, then URL (bookmarks only).
        </p>
      </div>

      {/* What Gets Searched */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">What Gets Searched</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 font-semibold text-gray-900">Field</th>
                <th className="py-2 pr-4 font-semibold text-gray-900">Applies To</th>
                <th className="py-2 font-semibold text-gray-900">Relevance Weight</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">Title</td>
                <td className="py-2 pr-4">All</td>
                <td className="py-2">Highest</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">Description</td>
                <td className="py-2 pr-4">All</td>
                <td className="py-2">High</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">Content</td>
                <td className="py-2 pr-4">All</td>
                <td className="py-2">Medium</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">URL</td>
                <td className="py-2 pr-4">Bookmarks only</td>
                <td className="py-2">Lowest</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Search Operators */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Search Operators</h2>
        <p className="text-gray-600 mb-4">
          Use operators to refine your queries:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 font-semibold text-gray-900">Operator</th>
                <th className="py-2 pr-4 font-semibold text-gray-900">Example</th>
                <th className="py-2 font-semibold text-gray-900">Effect</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5">&quot;quotes&quot;</code></td>
                <td className="py-2 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5">&quot;react hooks&quot;</code></td>
                <td className="py-2">Exact phrase match</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5">-term</code></td>
                <td className="py-2 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5">python -django</code></td>
                <td className="py-2">Exclude results containing term</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5">OR</code></td>
                <td className="py-2 pr-4"><code className="rounded bg-gray-100 px-1.5 py-0.5">react OR vue</code></td>
                <td className="py-2">Match either term</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Combining with Tags */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Combining Search with Tags</h2>
        <p className="text-gray-600 mb-3">
          Search queries can be combined with tag filters for precise results. When both are
          active, results must match the search query <em>and</em> the tag criteria.
        </p>
        <ul className="space-y-1.5 text-gray-600 mb-4">
          <li><strong>Tag match: all</strong> — results must have all selected tags (AND)</li>
          <li><strong>Tag match: any</strong> — results must have at least one selected tag (OR)</li>
        </ul>
        <p className="text-gray-600">
          Saved filters combine tag expressions with search for reusable views. See{' '}
          <Link to="/docs/features/tags-filters" className="text-[#d97b3d] hover:underline">
            Tags & Filters
          </Link>.
        </p>
      </div>

      {/* In-Content Search */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">In-Content Search</h2>
        <p className="text-gray-600 mb-3">
          Search <em>within</em> a single item&#39;s fields via the API. This is useful for
          finding specific text in long documents without loading the full content.
        </p>
        <ul className="space-y-2 text-gray-600 mb-5">
          <li><strong>Literal matching</strong> — finds exact string occurrences (not stemmed)</li>
          <li><strong>Field selection</strong> — search in content, title, description, or any combination</li>
          <li><strong>Case sensitivity</strong> — optional case-sensitive matching</li>
          <li><strong>Context lines</strong> — returns surrounding lines for each match</li>
        </ul>
        <InfoCallout variant="tip">
          In-content search is available via the API and MCP. AI assistants use it to find
          specific information in your content without loading entire documents.
        </InfoCallout>
      </div>
    </div>
  )
}
