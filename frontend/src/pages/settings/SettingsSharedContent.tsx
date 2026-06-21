/**
 * Settings page listing everything the user currently has publicly shared, so
 * they can audit ("what of mine is public?") and stop sharing from one place.
 *
 * Server-driven (pagination, sort by share date, type + date-range filters all
 * applied by the API via useSharedContent) so it stays correct at any number of
 * shared items. Rows link to the item detail (where the share URL can be copied —
 * the token is deliberately not on list responses) and unshare in place.
 */
import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useSharedContent } from '../../hooks/useSharedContent'
import { useShareMutations, type ShareableType } from '../../hooks/useShareMutations'
import { MultiSelectDropdown, LoadingSpinner } from '../../components/ui'
import type { DropdownOption } from '../../components/ui'
import {
  BookmarkIcon, NoteIcon, PromptIcon, ExternalLinkIcon, ChevronLeftIcon, ChevronRightIcon,
} from '../../components/icons'
import { CONTENT_TYPE_ICON_COLORS } from '../../constants/contentTypeStyles'
import { usePageTitle } from '../../hooks/usePageTitle'
import { formatShortDate, getApiErrorMessage } from '../../utils'
import type { ContentType, ContentListItem } from '../../types'

const PAGE_SIZE = 25

type DatePreset = 'all' | 'last7' | 'last30' | 'custom'

const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

const TYPE_OPTIONS: DropdownOption<ContentType>[] = [
  { value: 'bookmark', label: 'Bookmarks', icon: <BookmarkIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`} /> },
  { value: 'note', label: 'Notes', icon: <NoteIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.note}`} /> },
  { value: 'prompt', label: 'Prompts', icon: <PromptIcon className={`h-4 w-4 ${CONTENT_TYPE_ICON_COLORS.prompt}`} /> },
]

const PLURAL: Record<ContentType, ShareableType> = {
  bookmark: 'bookmarks',
  note: 'notes',
  prompt: 'prompts',
}

const TYPE_ICON: Record<ContentType, typeof BookmarkIcon> = {
  bookmark: BookmarkIcon,
  note: NoteIcon,
  prompt: PromptIcon,
}

/**
 * One shared item. Its own component so it can own a per-type share mutation
 * (hooks can't be called per-row from a loop).
 */
function SharedContentRow({ item, onUnshared }: { item: ContentListItem; onUnshared: () => void }): ReactNode {
  const type = PLURAL[item.type]
  const { unpublish } = useShareMutations(type)
  const Icon = TYPE_ICON[item.type]
  const detailPath = `/app/${type}/${item.id}`

  const handleUnshare = async (): Promise<void> => {
    try {
      await unpublish.mutateAsync(item.id)
      toast.success('Stopped sharing')
      onUnshared()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to stop sharing'))
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-gray-100 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${CONTENT_TYPE_ICON_COLORS[item.type]}`} />
      <Link
        to={detailPath}
        className="min-w-0 flex-1 truncate text-sm text-gray-900 hover:text-blue-600 hover:underline"
      >
        {item.title || '(untitled)'}
      </Link>
      <span className="w-28 shrink-0 text-right text-xs text-gray-400">
        {item.shared_at ? formatShortDate(item.shared_at) : ''}
      </span>
      <Link to={detailPath} aria-label="Open" className="btn-icon shrink-0">
        <ExternalLinkIcon className="h-4 w-4" />
      </Link>
      <button
        type="button"
        onClick={handleUnshare}
        disabled={unpublish.isPending}
        className="btn-ghost shrink-0 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        {unpublish.isPending ? 'Stopping…' : 'Unshare'}
      </button>
    </div>
  )
}

export function SettingsSharedContent(): ReactNode {
  usePageTitle('Shared Content')
  const [page, setPage] = useState(0)
  const [typeFilter, setTypeFilter] = useState<ContentType[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  // Date preset → ISO range (mirrors Version History).
  const { sharedAfter, sharedBefore } = useMemo(() => {
    if (datePreset === 'last7' || datePreset === 'last30') {
      const days = datePreset === 'last7' ? 7 : 30
      const end = new Date()
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
      return { sharedAfter: start.toISOString(), sharedBefore: end.toISOString() }
    }
    if (datePreset === 'custom') {
      return {
        sharedAfter: customStart ? new Date(customStart).toISOString() : undefined,
        sharedBefore: customEnd ? new Date(customEnd).toISOString() : undefined,
      }
    }
    return { sharedAfter: undefined, sharedBefore: undefined }
  }, [datePreset, customStart, customEnd])

  const { data, isLoading, isError, refetch } = useSharedContent({
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
    contentTypes: typeFilter.length > 0 ? typeFilter : undefined,
    sharedAfter,
    sharedBefore,
  })

  // Any filter change resets to the first page.
  const toggleType = (type: ContentType): void => {
    setTypeFilter(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
    setPage(0)
  }
  const toggleAllTypes = (selectAll: boolean): void => {
    setTypeFilter(selectAll ? TYPE_OPTIONS.map(o => o.value) : [])
    setPage(0)
  }
  const changeDatePreset = (preset: DatePreset): void => {
    setDatePreset(preset)
    setPage(0)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasFilters = typeFilter.length > 0 || datePreset !== 'all'

  // Unsharing the last row on a non-first page would otherwise strand the user
  // on an empty page with no controls; step back so they land on a populated one.
  // (Paging is bounded — Next is disabled past the last page — so unshare is the
  // only way to reach an out-of-range page.)
  const handleUnshared = (): void => {
    if (items.length === 1 && page > 0) setPage(p => p - 1)
  }

  return (
    <div className="max-w-4xl pt-3">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Shared Content</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything you’ve published to a public link. Open an item to copy or regenerate its link, or stop sharing it here.
        </p>
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <MultiSelectDropdown
          label="Type"
          options={TYPE_OPTIONS}
          selected={typeFilter}
          onChange={toggleType}
          onToggleAll={toggleAllTypes}
          testId="filter-type"
        />
        <select
          value={datePreset}
          onChange={(e) => changeDatePreset(e.target.value as DatePreset)}
          className="cursor-pointer rounded-lg border border-gray-200 bg-gray-50/50 px-2.5 py-1 text-sm text-gray-700 focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5"
          data-testid="filter-date"
        >
          {DATE_PRESET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {datePreset === 'custom' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1">
              <span className="text-xs text-gray-500">From</span>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => { setCustomStart(e.target.value); setPage(0) }}
                className="rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-0.5 text-xs"
                data-testid="filter-date-start"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-xs text-gray-500">To</span>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => { setCustomEnd(e.target.value); setPage(0) }}
                className="rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-0.5 text-xs"
                data-testid="filter-date-end"
              />
            </label>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" label="Loading shared content..." />
        </div>
      ) : isError ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-500">We couldn’t load your shared content.</p>
          <button type="button" onClick={() => refetch()} className="btn-secondary mt-4">Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm font-medium text-gray-900">
            {hasFilters ? 'No shared items match these filters' : 'You haven’t shared anything yet'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {hasFilters
              ? 'Try widening the type or date filters.'
              : 'Open any bookmark, note, or prompt and use its Share control to create a public link.'}
          </p>
        </div>
      ) : (
        <>
          {/* Column header */}
          <div className="flex items-center gap-3 border-b border-gray-200 pb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            <span className="h-4 w-4 shrink-0" />
            <span className="flex-1">Item</span>
            <span className="w-28 shrink-0 text-right">Shared</span>
            <span className="h-4 w-4 shrink-0" />
            <span className="w-[4.5rem] shrink-0" />
          </div>
          {items.map(item => (
            <SharedContentRow key={`${item.type}-${item.id}`} item={item} onUnshared={handleUnshared} />
          ))}

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-ghost"
                aria-label="Previous page"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={!data?.has_more}
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
