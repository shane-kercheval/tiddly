/**
 * Settings page for viewing all content version history.
 *
 * Shows a paginated list of all changes across bookmarks, notes, and prompts,
 * with filtering by entity type and links to view individual items.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUserHistory } from '../../hooks/useHistory'
import { BookmarkIcon, NoteIcon, PromptIcon } from '../../components/icons'
import type { HistoryEntityType, HistoryActionType } from '../../types'

/** Format action type for display */
function formatAction(action: HistoryActionType): string {
  const labels: Record<HistoryActionType, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    restore: 'Restored',
    archive: 'Archived',
    unarchive: 'Unarchived',
  }
  return labels[action] ?? action
}

/** Format source for display */
function formatSource(source: string): string {
  const labels: Record<string, string> = {
    WEB: 'Web',
    API: 'API',
    MCP_CONTENT: 'MCP',
    MCP_PROMPT: 'MCP',
    UNKNOWN: 'Unknown',
  }
  return labels[source] ?? source
}

/** Get icon for entity type */
function getEntityIcon(type: HistoryEntityType): ReactNode {
  switch (type) {
    case 'bookmark':
      return <BookmarkIcon className="w-4 h-4" />
    case 'note':
      return <NoteIcon className="w-4 h-4" />
    case 'prompt':
      return <PromptIcon className="w-4 h-4" />
    default:
      return null
  }
}

/** Get item title from metadata snapshot */
function getItemTitle(metadata: Record<string, unknown> | null): string {
  if (!metadata) return 'Untitled'
  return (metadata.title as string) || (metadata.name as string) || 'Untitled'
}

/** Get link path for entity */
function getEntityPath(type: HistoryEntityType, id: string): string {
  switch (type) {
    case 'bookmark':
      return `/app/bookmarks/${id}`
    case 'note':
      return `/app/notes/${id}`
    case 'prompt':
      return `/app/prompts/${id}`
    default:
      return '#'
  }
}

export function SettingsVersionHistory(): ReactNode {
  const [entityTypeFilter, setEntityTypeFilter] = useState<HistoryEntityType | undefined>()
  const [page, setPage] = useState(0)
  const limit = 50

  const { data: history, isLoading, error } = useUserHistory({
    entityType: entityTypeFilter,
    limit,
    offset: page * limit,
  })

  const filterButtons: { key: HistoryEntityType | undefined; label: string }[] = [
    { key: undefined, label: 'All' },
    { key: 'bookmark', label: 'Bookmarks' },
    { key: 'note', label: 'Notes' },
    { key: 'prompt', label: 'Prompts' },
  ]

  return (
    <div className="max-w-4xl pt-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Version History</h1>
        <p className="mt-1 text-sm text-gray-500">
          View all changes made to your bookmarks, notes, and prompts.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {filterButtons.map(({ key, label }) => (
          <button
            key={label}
            onClick={() => {
              setEntityTypeFilter(key)
              setPage(0)
            }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              entityTypeFilter === key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* History list */}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          Failed to load history. Please try refreshing the page.
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center p-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      ) : history?.items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
          No history found. Changes to your content will appear here.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history?.items.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-gray-700">
                        {getEntityIcon(entry.entity_type)}
                        <span className="capitalize text-sm">{entry.entity_type}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={getEntityPath(entry.entity_type, entry.entity_id)}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium"
                      >
                        {getItemTitle(entry.metadata_snapshot)}
                      </Link>
                      <div className="text-xs text-gray-400 mt-0.5">
                        v{entry.version}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatAction(entry.action)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatSource(entry.source)}
                      {entry.token_prefix && (
                        <span className="text-xs text-gray-400 ml-1">
                          ({entry.token_prefix}...)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {page * limit + 1}-{Math.min((page + 1) * limit, history?.total ?? 0)} of {history?.total ?? 0}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!history?.has_more}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
