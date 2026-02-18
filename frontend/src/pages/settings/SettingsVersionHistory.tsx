/**
 * Settings page for viewing all content version history.
 *
 * Shows a paginated list of all changes across bookmarks, notes, and prompts,
 * with filtering by entity type, action, source, and date range.
 */
import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useUserHistory, useVersionDiff } from '../../hooks/useHistory'
import { MultiSelectDropdown } from '../../components/ui'
import type { DropdownOption } from '../../components/ui'
import { BookmarkIcon, NoteIcon, PromptIcon, CloseIconFilled, ChevronLeftIcon, ChevronRightIcon } from '../../components/icons'
import { ActionDot } from '../../components/ActionDot'
import { ChangeIndicators } from '../../components/ChangeIndicators'
import { usePageTitle } from '../../hooks/usePageTitle'
import { VersionDiffPanel } from '../../components/VersionDiffPanel'
import { CONTENT_TYPE_ICON_COLORS } from '../../constants/contentTypeStyles'
import { formatAction, formatSource, isAuditAction } from '../../constants/historyLabels'
import type { ContentType, HistoryActionType, HistoryEntry } from '../../types'

/** Date preset options */
type DatePreset = 'all' | 'last7' | 'last30' | 'custom'

/** Display source types (MCP combines both mcp-content and mcp-prompt) */
type DisplaySourceType = 'web' | 'api' | 'mcp' | 'iphone' | 'unknown'

/** Map display source to actual API source values */
function displaySourceToApiSources(source: DisplaySourceType): string[] {
  if (source === 'mcp') {
    return ['mcp-content', 'mcp-prompt']
  }
  return [source]
}

/** Dropdown options for entity type filter */
const ENTITY_TYPE_OPTIONS: DropdownOption<ContentType>[] = [
  { value: 'bookmark', label: 'Bookmarks', icon: <BookmarkIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`} /> },
  { value: 'note', label: 'Notes', icon: <NoteIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.note}`} /> },
  { value: 'prompt', label: 'Prompts', icon: <PromptIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.prompt}`} /> },
]

/** Dropdown options for action filter */
const ACTION_OPTIONS: DropdownOption<HistoryActionType>[] = [
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'restore', label: 'Restore' },
  { value: 'undelete', label: 'Undelete' },
  { value: 'archive', label: 'Archive' },
  { value: 'unarchive', label: 'Unarchive' },
]

/** Dropdown options for source filter */
const SOURCE_OPTIONS: DropdownOption<DisplaySourceType>[] = [
  { value: 'web', label: 'Web' },
  { value: 'api', label: 'API' },
  { value: 'mcp', label: 'MCP' },
  { value: 'iphone', label: 'iPhone' },
  { value: 'unknown', label: 'Unknown' },
]

/** Date preset options for dropdown */
const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

/** Get colored icon for entity type */
function getEntityIcon(type: ContentType): ReactNode {
  switch (type) {
    case 'bookmark':
      return <BookmarkIcon className={`w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`} />
    case 'note':
      return <NoteIcon className={`w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.note}`} />
    case 'prompt':
      return <PromptIcon className={`w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.prompt}`} />
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
function getEntityPath(type: ContentType, id: string): string {
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
  usePageTitle('Settings - History')
  // Filter state - empty arrays mean "show all"
  const [entityTypeFilter, setEntityTypeFilter] = useState<ContentType[]>([])
  const [actionFilter, setActionFilter] = useState<HistoryActionType[]>([])
  const [sourceFilter, setSourceFilter] = useState<DisplaySourceType[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [page, setPage] = useState(0)
  const limit = 25

  // Diff view state
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null)

  // Calculate date range from preset or custom inputs
  const { startDate, endDate } = useMemo(() => {
    if (datePreset === 'all') {
      return { startDate: undefined, endDate: undefined }
    }
    if (datePreset === 'last7') {
      const end = new Date()
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { startDate: start.toISOString(), endDate: end.toISOString() }
    }
    if (datePreset === 'last30') {
      const end = new Date()
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { startDate: start.toISOString(), endDate: end.toISOString() }
    }
    // Custom: datetime-local returns local time, convert to UTC
    return {
      startDate: customStartDate ? new Date(customStartDate).toISOString() : undefined,
      endDate: customEndDate ? new Date(customEndDate).toISOString() : undefined,
    }
  }, [datePreset, customStartDate, customEndDate])

  // Toggle helpers - each resets pagination
  const toggleEntityType = (type: ContentType): void => {
    setEntityTypeFilter(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
    setPage(0)
  }

  const toggleAction = (action: HistoryActionType): void => {
    setActionFilter(prev =>
      prev.includes(action) ? prev.filter(a => a !== action) : [...prev, action]
    )
    setPage(0)
  }

  const toggleSource = (source: DisplaySourceType): void => {
    setSourceFilter(prev =>
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    )
    setPage(0)
  }

  // Toggle all helpers
  const toggleAllEntityTypes = (selectAll: boolean): void => {
    setEntityTypeFilter(selectAll ? ENTITY_TYPE_OPTIONS.map(o => o.value) : [])
    setPage(0)
  }

  const toggleAllActions = (selectAll: boolean): void => {
    setActionFilter(selectAll ? ACTION_OPTIONS.map(o => o.value) : [])
    setPage(0)
  }

  const toggleAllSources = (selectAll: boolean): void => {
    setSourceFilter(selectAll ? SOURCE_OPTIONS.map(o => o.value) : [])
    setPage(0)
  }

  // Convert display source filter to API source values
  const apiSources = useMemo(() => {
    if (sourceFilter.length === 0) return undefined
    return sourceFilter.flatMap(displaySourceToApiSources)
  }, [sourceFilter])

  const handleDatePresetChange = (preset: DatePreset): void => {
    setDatePreset(preset)
    setPage(0)
  }

  const handleCustomStartDateChange = (value: string): void => {
    setCustomStartDate(value)
    setPage(0)
  }

  const handleCustomEndDateChange = (value: string): void => {
    setCustomEndDate(value)
    setPage(0)
  }

  // Check if any filters are active
  const hasActiveFilters =
    entityTypeFilter.length > 0 ||
    actionFilter.length > 0 ||
    sourceFilter.length > 0 ||
    datePreset !== 'all'

  // Clear all filters
  const clearAllFilters = (): void => {
    setEntityTypeFilter([])
    setActionFilter([])
    setSourceFilter([])
    setDatePreset('all')
    setCustomStartDate('')
    setCustomEndDate('')
    setPage(0)
  }

  const { data: history, isLoading, error } = useUserHistory({
    contentTypes: entityTypeFilter.length > 0 ? entityTypeFilter : undefined,
    actions: actionFilter.length > 0 ? actionFilter : undefined,
    sources: apiSources,
    startDate,
    endDate,
    limit,
    offset: page * limit,
  })

  // Fetch diff for selected version (skip for audit actions)
  const selectedVersion = selectedEntry && !isAuditAction(selectedEntry.action)
    ? selectedEntry.version
    : null
  const { data: diffData } = useVersionDiff(
    selectedEntry?.content_type ?? 'bookmark',
    selectedEntry?.content_id ?? '',
    selectedVersion
  )

  // Toggle entry selection - clicking same entry closes diff view
  // Audit entries close any open selection but don't open a new one
  const handleEntryClick = (entry: HistoryEntry): void => {
    if (isAuditAction(entry.action)) {
      setSelectedEntry(null)
      return
    }
    setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)
  }

  return (
    <div className="max-w-4xl pt-3">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Version History</h1>
        <p className="mt-1 text-sm text-gray-500">
          View all changes made to your bookmarks, notes, and prompts.
        </p>
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <MultiSelectDropdown
          label="Type"
          options={ENTITY_TYPE_OPTIONS}
          selected={entityTypeFilter}
          onChange={toggleEntityType}
          onToggleAll={toggleAllEntityTypes}
          testId="filter-type"
        />

        <MultiSelectDropdown
          label="Action"
          options={ACTION_OPTIONS}
          selected={actionFilter}
          onChange={toggleAction}
          onToggleAll={toggleAllActions}
          testId="filter-action"
        />

        <MultiSelectDropdown
          label="Source"
          options={SOURCE_OPTIONS}
          selected={sourceFilter}
          onChange={toggleSource}
          onToggleAll={toggleAllSources}
          testId="filter-source"
        />

        {/* Date filter - single select */}
        <div className="flex flex-col md:flex-row md:items-center gap-1.5 w-full md:w-auto">
          <select
            value={datePreset}
            onChange={(e) => handleDatePresetChange(e.target.value as DatePreset)}
            className={`appearance-none cursor-pointer rounded-lg border px-2.5 py-1 pr-7 text-sm focus:outline-none focus:ring-2 bg-[length:1rem_1rem] bg-[right_0.375rem_center] bg-no-repeat transition-colors ${
              datePreset !== 'all'
                ? "border-blue-200 bg-blue-50/50 text-blue-700 focus:border-blue-300 focus:ring-blue-900/5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%231d4ed8%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]"
                : "border-gray-200 bg-gray-50/50 text-gray-700 focus:border-gray-300 focus:ring-gray-900/5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]"
            }`}
            data-testid="filter-date"
          >
            {DATE_PRESET_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {datePreset === 'custom' && (
            <div className="flex flex-col md:flex-row gap-1.5">
              <label className="flex items-center gap-1">
                <span className="text-xs text-gray-500">From</span>
                <input
                  type="datetime-local"
                  value={customStartDate}
                  onChange={(e) => handleCustomStartDateChange(e.target.value)}
                  className="text-xs rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-0.5 flex-1"
                  data-testid="filter-date-start"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-xs text-gray-500">To</span>
                <input
                  type="datetime-local"
                  value={customEndDate}
                  onChange={(e) => handleCustomEndDateChange(e.target.value)}
                  className="text-xs rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-0.5 flex-1"
                  data-testid="filter-date-end"
                />
              </label>
            </div>
          )}
        </div>

      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="active-filters">
          <span className="text-sm text-gray-400">Filtering by:</span>

          {/* Entity type chips */}
          {entityTypeFilter.map(type => {
            const option = ENTITY_TYPE_OPTIONS.find(o => o.value === type)
            return (
              <button
                key={`type-${type}`}
                onClick={() => toggleEntityType(type)}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors group"
                data-testid={`active-filter-type-${type}`}
              >
                {option?.icon}
                <span>{option?.label}</span>
                <CloseIconFilled className="h-3 w-3 text-blue-400 group-hover:text-red-500 transition-colors" />
              </button>
            )
          })}

          {/* Action chips */}
          {actionFilter.map(action => {
            const option = ACTION_OPTIONS.find(o => o.value === action)
            return (
              <button
                key={`action-${action}`}
                onClick={() => toggleAction(action)}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors group"
                data-testid={`active-filter-action-${action}`}
              >
                <span>{option?.label}</span>
                <CloseIconFilled className="h-3 w-3 text-blue-400 group-hover:text-red-500 transition-colors" />
              </button>
            )
          })}

          {/* Source chips */}
          {sourceFilter.map(source => {
            const option = SOURCE_OPTIONS.find(o => o.value === source)
            return (
              <button
                key={`source-${source}`}
                onClick={() => toggleSource(source)}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors group"
                data-testid={`active-filter-source-${source}`}
              >
                <span>{option?.label}</span>
                <CloseIconFilled className="h-3 w-3 text-blue-400 group-hover:text-red-500 transition-colors" />
              </button>
            )
          })}

          {/* Date chip */}
          {datePreset !== 'all' && (
            <button
              onClick={() => handleDatePresetChange('all')}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors group"
              data-testid="active-filter-date"
            >
              <span>{DATE_PRESET_OPTIONS.find(o => o.value === datePreset)?.label}</span>
              <CloseIconFilled className="h-3 w-3 text-blue-400 group-hover:text-red-500 transition-colors" />
            </button>
          )}

          {/* Clear all */}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs text-gray-500 hover:text-red-600 transition-colors"
            data-testid="filter-clear-all"
          >
            Clear all
          </button>
        </div>
      )}

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
          {/* Mobile card view */}
          <div className="md:hidden space-y-2">
            {history?.items.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div
                  className={`p-3 ${
                    isAuditAction(entry.action) ? 'bg-gray-50/50' : 'cursor-pointer'
                  } ${selectedEntry?.id === entry.id ? 'bg-blue-50' : ''}`}
                  onClick={() => handleEntryClick(entry)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {getEntityIcon(entry.content_type)}
                      <Link
                        to={getEntityPath(entry.content_type, entry.content_id)}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium truncate"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {getItemTitle(entry.metadata_snapshot)}
                      </Link>
                      {entry.version !== null ? (
                        <span className="text-xs text-gray-400 shrink-0">v{entry.version}</span>
                      ) : (
                        <span className="text-xs text-gray-400 italic shrink-0">audit</span>
                      )}
                      <ChangeIndicators changed={entry.changed_fields} />
                    </div>
                  </div>
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
                    isAuditAction(entry.action) ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    <span className="inline-flex items-center gap-1"><ActionDot action={entry.action} />{formatAction(entry.action)}</span>
                    <span>{formatSource(entry.source)}</span>
                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                </div>
                {/* Inline diff view - only for content actions */}
                {selectedEntry?.id === entry.id && !isAuditAction(entry.action) && (
                  <div className="border-t border-gray-200 bg-gray-50">
                    <VersionDiffPanel
                      diffData={diffData ?? null}
                      entityType={entry.content_type}
                      action={entry.action}
                      maxHeight={400}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block rounded-lg border border-gray-200 bg-white overflow-hidden">
            <table className="w-full divide-y divide-gray-200 table-fixed">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Item</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-28">Action</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-20">Source</th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-44">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {history?.items.map((entry) => (
                  <tr key={entry.id} className="group">
                    <td
                      colSpan={4}
                      className="p-0"
                    >
                      {/* Clickable row content */}
                      <div
                        className={`grid grid-cols-[1fr_7rem_5rem_11rem] transition-colors ${
                          isAuditAction(entry.action) ? 'bg-gray-50/50' : 'cursor-pointer hover:bg-gray-50'
                        } ${
                          selectedEntry?.id === entry.id ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => handleEntryClick(entry)}
                      >
                        <div className="px-3 py-2.5 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0">{getEntityIcon(entry.content_type)}</span>
                            <Link
                              to={getEntityPath(entry.content_type, entry.content_id)}
                              className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {getItemTitle(entry.metadata_snapshot)}
                            </Link>
                            {entry.version !== null ? (
                              <span className="text-xs text-gray-400 shrink-0">v{entry.version}</span>
                            ) : (
                              <span className="text-xs text-gray-400 italic shrink-0">audit</span>
                            )}
                            <ChangeIndicators changed={entry.changed_fields} />
                          </div>
                        </div>
                        <div className="px-3 py-2.5 text-sm text-gray-500 flex items-center gap-1.5">
                          <ActionDot action={entry.action} />
                          {formatAction(entry.action)}
                        </div>
                        <div className={`px-3 py-2.5 text-sm ${isAuditAction(entry.action) ? 'text-gray-400' : 'text-gray-500'}`}>
                          {formatSource(entry.source)}
                        </div>
                        <div className={`px-3 py-2.5 text-sm whitespace-nowrap ${isAuditAction(entry.action) ? 'text-gray-400' : 'text-gray-500'}`}>
                          {new Date(entry.created_at).toLocaleString()}
                        </div>
                      </div>
                      {/* Inline diff view - only for content actions */}
                      {selectedEntry?.id === entry.id && !isAuditAction(entry.action) && (
                        <div className="border-t border-gray-200 bg-gray-50">
                          <VersionDiffPanel
                            diffData={diffData ?? null}
                            entityType={entry.content_type}
                            action={entry.action}
                          />
                        </div>
                      )}
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
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="btn-ghost"
                aria-label="Previous page"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!history?.has_more}
                className="btn-ghost"
                aria-label="Next page"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
