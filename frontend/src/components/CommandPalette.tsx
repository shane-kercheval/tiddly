/**
 * Command palette overlay with two views:
 * 1. Main command list (search, filters, settings, new items)
 * 2. Search sub-view (full-text search with results)
 *
 * Keyboard shortcuts:
 * - Cmd+Shift+P: Opens main palette
 * - /: Opens palette directly into search sub-view
 * - Escape: Closes palette from any view
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useContentQuery } from '../hooks/useContentQuery'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useContentTypeFilterStore, ALL_CONTENT_TYPES } from '../stores/contentTypeFilterStore'
import { useTagsStore } from '../stores/tagsStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { SortByOption } from '../constants/sortOptions'
import { BASE_SORT_OPTIONS } from '../constants/sortOptions'
import { BookmarkCard } from './BookmarkCard'
import { NoteCard } from './NoteCard'
import { PromptCard } from './PromptCard'
import {
  LoadingSpinnerCentered,
  ErrorState,
  EmptyState,
  SearchFilterBar,
  SelectedTagsDisplay,
  PaginationControls,
  ContentTypeFilterChips,
} from './ui'
import {
  SearchIcon,
  BookmarkIcon,
  NoteIcon,
  PromptIcon,
  TagIcon,
  KeyIcon,
  SparklesIcon,
  HistoryIcon,
  HelpIcon,
  AdjustmentsIcon,
} from './icons'
import { getFilterRoute, getBuiltinRoute } from './sidebar/routes'
import { getFilterIcon, getBuiltinIcon } from './sidebar/sidebarDndUtils'
import type {
  ContentListItem,
  ContentSearchParams,
  BookmarkListItem,
  NoteListItem,
  PromptListItem,
  ContentType,
  SidebarItemComputed,
  SidebarBuiltinItemComputed,
  SidebarFilterItemComputed,
  SidebarCollectionComputed,
} from '../types'
import type { PageSize } from '../stores/uiPreferencesStore'

type PaletteView = 'commands' | 'search'

interface CommandPaletteProps {
  isOpen: boolean
  initialView?: PaletteView
  onClose: () => void
  onShowShortcuts?: () => void
}

// --- Command definitions ---

interface CommandItem {
  id: string
  label: string
  icon: ReactNode
  action: () => void
  /** Keyboard shortcut hint displayed on the right side */
  shortcut?: string[]
}

/** Sort options available in search (relevance + base options) */
const SEARCH_SORT_OPTIONS: readonly SortByOption[] = ['relevance', ...BASE_SORT_OPTIONS]
const SINGLE_DIRECTION_OPTIONS: ReadonlySet<SortByOption> = new Set(['relevance'])

/** View key for tag filter isolation in the command palette */
const PALETTE_VIEW_KEY = 'palette-search'

/** Date-related sort options - only show dates on cards when sorting by these */
const DATE_SORT_OPTIONS: ReadonlySet<SortByOption> = new Set([
  'created_at', 'updated_at', 'last_used_at', 'archived_at', 'deleted_at',
])

// --- Converters (same as Search page) ---

function toBookmarkListItem(item: ContentListItem): BookmarkListItem {
  return {
    id: item.id,
    url: item.url || '',
    title: item.title,
    description: item.description,
    summary: null,
    tags: item.tags,
    created_at: item.created_at,
    updated_at: item.updated_at,
    last_used_at: item.last_used_at,
    deleted_at: item.deleted_at,
    archived_at: item.archived_at,
    content_preview: item.content_preview,
  }
}

function toNoteListItem(item: ContentListItem): NoteListItem {
  return {
    id: item.id,
    title: item.title || '',
    description: item.description,
    tags: item.tags,
    created_at: item.created_at,
    updated_at: item.updated_at,
    last_used_at: item.last_used_at,
    deleted_at: item.deleted_at,
    archived_at: item.archived_at,
    version: item.version || 1,
    content_preview: item.content_preview,
  }
}

function toPromptListItem(item: ContentListItem): PromptListItem {
  return {
    id: item.id,
    name: item.name || '',
    title: item.title,
    description: item.description,
    tags: item.tags,
    arguments: item.arguments || [],
    created_at: item.created_at,
    updated_at: item.updated_at,
    last_used_at: item.last_used_at,
    deleted_at: item.deleted_at,
    archived_at: item.archived_at,
    content_preview: item.content_preview,
  }
}

/** Collect all nav items (builtins + filters) from sidebar in flattened order (same as collapsed sidebar) */
function collectNavItems(items: SidebarItemComputed[]): (SidebarBuiltinItemComputed | SidebarFilterItemComputed)[] {
  const result: (SidebarBuiltinItemComputed | SidebarFilterItemComputed)[] = []
  for (const item of items) {
    if (item.type === 'builtin' || item.type === 'filter') {
      result.push(item)
    } else if (item.type === 'collection') {
      for (const child of (item as SidebarCollectionComputed).items) {
        result.push(child)
      }
    }
  }
  return result
}

export function CommandPalette({ isOpen, initialView = 'commands', onClose, onShowShortcuts }: CommandPaletteProps): ReactNode {
  // Render inner component only when open — unmount/remount resets all state naturally
  if (!isOpen) return null
  return <CommandPaletteInner initialView={initialView} onClose={onClose} onShowShortcuts={onShowShortcuts} />
}

function CommandPaletteInner({ initialView, onClose, onShowShortcuts }: { initialView: PaletteView; onClose: () => void; onShowShortcuts?: () => void }): ReactNode {
  const navigate = useNavigate()
  const [view, setView] = useState<PaletteView>(initialView)
  const [commandFilter, setCommandFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const commandListRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  // Track real mouse movement to avoid selecting items under cursor on open
  const [mouseMoved, setMouseMoved] = useState(false)

  // Search state (local, not URL-based since this is a modal)
  const [searchQuery, setSearchQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [userSortOverride, setUserSortOverride] = useState<{ sortBy: SortByOption; sortOrder: 'asc' | 'desc' } | undefined>(undefined)

  const { pageSize, setPageSize } = useUIPreferencesStore()

  // Tag filters (isolated to palette-search view)
  const {
    getSelectedTags,
    getTagMatch,
    addTag,
    removeTag,
    setTagMatch,
    clearFilters: clearTagFilters,
  } = useTagFilterStore()
  const selectedTags = getSelectedTags(PALETTE_VIEW_KEY)
  const tagMatch = getTagMatch(PALETTE_VIEW_KEY)

  // Content type filter
  const { getSelectedTypes, toggleType } = useContentTypeFilterStore()
  const selectedContentTypes = getSelectedTypes('search', ALL_CONTENT_TYPES)
  const isBookmarksOnly = selectedContentTypes.length === 1 && selectedContentTypes[0] === 'bookmark'

  const { tags: tagSuggestions } = useTagsStore()

  // Sidebar data for command list
  const sidebar = useSettingsStore((state) => state.sidebar)
  // Debounce search query
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  // Sort
  const effectiveSortBy = userSortOverride?.sortBy
  const effectiveSortOrder = userSortOverride?.sortOrder
  const sortValue = userSortOverride
    ? `${userSortOverride.sortBy}-${userSortOverride.sortOrder}`
    : 'relevance-desc'
  const displaySortBy: SortByOption = userSortOverride?.sortBy ?? 'relevance'
  const showDates = DATE_SORT_OPTIONS.has(displaySortBy)

  // Search params
  const currentParams: ContentSearchParams = useMemo(
    () => ({
      q: debouncedSearchQuery || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      tag_match: selectedTags.length > 0 ? tagMatch : undefined,
      sort_by: effectiveSortBy,
      sort_order: effectiveSortOrder,
      offset,
      limit: pageSize,
      view: 'active' as const,
      content_types: selectedContentTypes,
    }),
    [debouncedSearchQuery, selectedTags, tagMatch, effectiveSortBy, effectiveSortOrder, offset, pageSize, selectedContentTypes]
  )

  const hasSearchCriteria = !!debouncedSearchQuery || selectedTags.length > 0
  const {
    data: queryData,
    isLoading,
    error: queryError,
    refetch,
  } = useContentQuery(currentParams, { enabled: view === 'search' && hasSearchCriteria })

  const items = queryData?.items ?? []
  const total = queryData?.total ?? 0
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to fetch content') : null

  // Manage body scroll and focus restore on mount/unmount
  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      if (previousActiveElement.current) {
        previousActiveElement.current.focus()
      }
    }
  }, [])

  // Focus appropriate input when view changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (view === 'commands') {
        commandInputRef.current?.focus()
      } else {
        searchInputRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [view])

  // Handle escape with capture phase
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        e.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [view, onClose])

  // Navigate and close
  const navigateAndClose = useCallback(
    (path: string) => {
      navigate(path)
      onClose()
    },
    [navigate, onClose]
  )

  // Build command list
  const commands = useMemo((): CommandItem[] => {
    const cmds: CommandItem[] = []

    // 1. Search
    cmds.push({
      id: 'search',
      label: 'Search',
      icon: <SearchIcon className="h-4 w-4" />,
      action: () => setView('search'),
      shortcut: ['/'],
    })

    // 2. Keyboard shortcuts
    if (onShowShortcuts) {
      cmds.push({
        id: 'shortcuts',
        label: 'Keyboard Shortcuts',
        icon: <HelpIcon className="h-4 w-4" />,
        action: () => { onClose(); onShowShortcuts() },
        shortcut: ['\u2318', '/'],
      })
    }

    // 3. New items
    cmds.push({
      id: 'new-note',
      label: 'New Note',
      icon: <NoteIcon className="h-4 w-4" />,
      action: () => navigateAndClose('/app/notes/new'),
    })
    cmds.push({
      id: 'new-bookmark',
      label: 'New Bookmark',
      icon: <BookmarkIcon className="h-4 w-4" />,
      action: () => navigateAndClose('/app/bookmarks/new'),
    })
    cmds.push({
      id: 'new-prompt',
      label: 'New Prompt',
      icon: <PromptIcon className="h-4 w-4" />,
      action: () => navigateAndClose('/app/prompts/new'),
    })

    // 4. Sidebar nav items (builtins + filters) in flattened sidebar order
    if (sidebar) {
      const navItems = collectNavItems(sidebar.items)
      for (const item of navItems) {
        if (item.type === 'builtin') {
          cmds.push({
            id: `builtin-${item.key}`,
            label: item.name,
            icon: getBuiltinIcon(item.key),
            action: () => navigateAndClose(getBuiltinRoute(item.key)),
          })
        } else {
          cmds.push({
            id: `filter-${item.id}`,
            label: `Filter: ${item.name}`,
            icon: getFilterIcon(item.content_types),
            action: () => navigateAndClose(getFilterRoute(item.id)),
          })
        }
      }
    }

    // 5. Settings pages
    const settingsItems: { label: string; path: string; icon: ReactNode }[] = [
      { label: 'Settings: General', path: '/app/settings/general', icon: <AdjustmentsIcon className="h-4 w-4" /> },
      { label: 'Settings: Tags', path: '/app/settings/tags', icon: <TagIcon className="h-4 w-4" /> },
      { label: 'Settings: Personal Access Tokens', path: '/app/settings/tokens', icon: <KeyIcon className="h-4 w-4" /> },
      { label: 'Settings: AI Integration', path: '/app/settings/mcp', icon: <SparklesIcon className="h-4 w-4" /> },
      { label: 'Settings: Version History', path: '/app/settings/history', icon: <HistoryIcon className="h-4 w-4" /> },
      { label: 'Settings: FAQ', path: '/app/settings/faq', icon: <HelpIcon className="h-4 w-4" /> },
    ]
    for (const s of settingsItems) {
      cmds.push({
        id: `settings-${s.path}`,
        label: s.label,
        icon: s.icon,
        action: () => navigateAndClose(s.path),
      })
    }

    return cmds
  }, [sidebar, navigateAndClose, onShowShortcuts, onClose])

  // Filter commands by search text
  const filteredCommands = useMemo(() => {
    if (!commandFilter) return commands
    const lower = commandFilter.toLowerCase()
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(lower))
  }, [commands, commandFilter])

  // Clamp selectedIndex to valid range (list may shrink when commands/sidebar changes)
  const clampedIndex = Math.min(selectedIndex, Math.max(filteredCommands.length - 1, 0))

  // Scroll selected item into view
  useEffect(() => {
    if (view !== 'commands') return
    const list = commandListRef.current
    if (!list) return
    const items = list.querySelectorAll('[data-command-item]')
    items[clampedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex, view])

  // Command list keyboard navigation
  const handleCommandKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        filteredCommands[clampedIndex]?.action()
      } else if (e.key === 'Tab') {
        // Tab moves focus into the list; prevent default browser tab
        e.preventDefault()
        const list = commandListRef.current
        if (!list) return
        const items = list.querySelectorAll('[data-command-item]')
        const target = items[clampedIndex] as HTMLElement | undefined
        target?.focus()
      }
    },
    [filteredCommands, clampedIndex]
  )

  // Search handlers
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchQuery(value)
      setOffset(0)
      if (!value) {
        setUserSortOverride(undefined)
      }
    },
    []
  )

  const handleTagClick = useCallback(
    (tag: string) => {
      if (!selectedTags.includes(tag)) {
        addTag(PALETTE_VIEW_KEY, tag)
        setOffset(0)
      }
    },
    [selectedTags, addTag]
  )

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      removeTag(PALETTE_VIEW_KEY, tagToRemove)
      setOffset(0)
    },
    [removeTag]
  )

  const handleTagMatchChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTagMatch(PALETTE_VIEW_KEY, e.target.value as 'all' | 'any')
    },
    [setTagMatch]
  )

  const handleClearTagFilters = useCallback(() => {
    clearTagFilters(PALETTE_VIEW_KEY)
    setOffset(0)
  }, [clearTagFilters])

  const handleSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value
      const [newSortBy, newSortOrder] = value.split('-') as [SortByOption, 'asc' | 'desc']
      if (newSortBy === 'relevance') {
        setUserSortOverride(undefined)
      } else {
        setUserSortOverride({ sortBy: newSortBy, sortOrder: newSortOrder })
      }
    },
    []
  )

  const handlePageChange = useCallback((newOffset: number) => {
    setOffset(newOffset)
  }, [])

  const handlePageSizeChange = useCallback(
    (newSize: PageSize) => {
      setPageSize(newSize)
      setOffset(0)
    },
    [setPageSize]
  )

  const handleContentTypeToggle = useCallback(
    (type: ContentType) => {
      toggleType('search', type, ALL_CONTENT_TYPES)
      setOffset(0)
    },
    [toggleType]
  )

  // Result click handlers (navigate and close)
  const handleViewBookmark = useCallback(
    (bookmark: BookmarkListItem) => navigateAndClose(`/app/bookmarks/${bookmark.id}`),
    [navigateAndClose]
  )

  const handleViewNote = useCallback(
    (note: NoteListItem) => navigateAndClose(`/app/notes/${note.id}`),
    [navigateAndClose]
  )

  const handleViewPrompt = useCallback(
    (prompt: PromptListItem) => navigateAndClose(`/app/prompts/${prompt.id}`),
    [navigateAndClose]
  )

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  // Pagination values
  const totalPages = Math.ceil(total / pageSize)
  const currentPage = Math.floor(offset / pageSize) + 1
  const hasMore = offset + items.length < total

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-3xl mx-4 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col"
        style={{ height: '85vh', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {view === 'commands' ? (
          /* ===== Main Command View ===== */
          <>
            {/* Search input */}
            <div className="px-4 border-b border-gray-100 flex items-center" style={{ height: 34 }}>
              <input
                ref={commandInputRef}
                type="text"
                value={commandFilter}
                onChange={(e) => { setCommandFilter(e.target.value); setSelectedIndex(0) }}
                onKeyDown={handleCommandKeyDown}
                placeholder="Type a command..."
                className="w-full text-sm bg-transparent outline-none text-gray-900 placeholder-gray-400"
              />
            </div>

            {/* Command list */}
            <div ref={commandListRef} className="flex-1 overflow-y-auto py-1 px-1" onMouseMove={() => { if (!mouseMoved) setMouseMoved(true) }}>
              {filteredCommands.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-gray-400">No matching commands</div>
              ) : (
                filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.id}
                    data-command-item
                    onClick={cmd.action}
                    onMouseEnter={() => { if (mouseMoved) setSelectedIndex(index) }}
                    style={{ height: 32 }}
                    className={`flex items-center gap-3 w-full px-3 text-left text-sm rounded-lg transition-colors ${
                      index === clampedIndex
                        ? 'bg-blue-50 text-blue-700 ring-2 ring-inset ring-blue-500'
                        : `text-gray-700 ${mouseMoved ? 'hover:bg-gray-50' : ''}`
                    }`}
                  >
                    <span className={`shrink-0 ${index === clampedIndex ? 'text-blue-500' : 'text-gray-400'}`}>{cmd.icon}</span>
                    <span className="truncate flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="hidden sm:flex items-center gap-0.5 shrink-0 ml-2">
                        {cmd.shortcut.map((key, i) => (
                          <kbd key={i} className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-medium text-gray-400 bg-gray-100 rounded border border-gray-200">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          /* ===== Search Sub-View ===== */
          <>
            {/* Search controls */}
            <div className="px-4 pt-3 pb-2 space-y-2 border-b border-gray-100 overflow-hidden">
              <SearchFilterBar
                searchInputRef={searchInputRef}
                searchQuery={searchQuery}
                onSearchChange={handleSearchChange}
                searchPlaceholder="Search all content..."
                tagSuggestions={tagSuggestions}
                selectedTags={selectedTags}
                onTagSelect={handleTagClick}
                sortValue={sortValue}
                onSortChange={handleSortChange}
                availableSortOptions={SEARCH_SORT_OPTIONS}
                singleDirectionOptions={SINGLE_DIRECTION_OPTIONS}
              />
              <ContentTypeFilterChips
                selectedTypes={selectedContentTypes}
                availableTypes={ALL_CONTENT_TYPES}
                onChange={handleContentTypeToggle}
              />
              <SelectedTagsDisplay
                selectedTags={selectedTags}
                tagMatch={tagMatch}
                onRemoveTag={handleRemoveTag}
                onTagMatchChange={handleTagMatchChange}
                onClearFilters={handleClearTagFilters}
              />
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
              {!hasSearchCriteria ? (
                <div className="px-4 py-12">
                  <EmptyState
                    icon={<SearchIcon />}
                    title="Search across all your content"
                    description="Search bookmarks, notes, and prompts by title, description, tags, or content."
                  />
                </div>
              ) : isLoading ? (
                <div className="py-8">
                  <LoadingSpinnerCentered label="Searching..." />
                </div>
              ) : error ? (
                <div className="px-4 py-8">
                  <ErrorState message={error} onRetry={() => refetch()} />
                </div>
              ) : items.length === 0 ? (
                <div className="px-4 py-12">
                  <EmptyState
                    icon={<SearchIcon />}
                    title="No results found"
                    description="Try adjusting your search or filters."
                  />
                </div>
              ) : (
                <div className="pb-2 px-3 [&_.card]:rounded-none">
                  <div>
                    {items.map((item) => {
                      if (item.type === 'bookmark') {
                        return (
                          <BookmarkCard
                            key={`bookmark-${item.id}`}
                            bookmark={toBookmarkListItem(item)}
                            view="active"
                            sortBy={displaySortBy}
                            showDate={showDates}
                            showContentTypeIcon={!isBookmarksOnly}
                            onClick={handleViewBookmark}
                            onTagClick={handleTagClick}
                          />
                        )
                      }
                      if (item.type === 'prompt') {
                        return (
                          <PromptCard
                            key={`prompt-${item.id}`}
                            prompt={toPromptListItem(item)}
                            view="active"
                            sortBy={displaySortBy}
                            showDate={showDates}
                            onClick={handleViewPrompt}
                            onTagClick={handleTagClick}
                          />
                        )
                      }
                      return (
                        <NoteCard
                          key={`note-${item.id}`}
                          note={toNoteListItem(item)}
                          view="active"
                          sortBy={displaySortBy}
                          showDate={showDates}
                          onClick={handleViewNote}
                          onTagClick={handleTagClick}
                        />
                      )
                    })}
                  </div>

                  <div className="px-4 pt-2">
                    <PaginationControls
                      currentPage={currentPage}
                      totalPages={totalPages}
                      pageSize={pageSize}
                      hasMore={hasMore}
                      offset={offset}
                      total={total}
                      onPageChange={handlePageChange}
                      onPageSizeChange={handlePageSizeChange}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
