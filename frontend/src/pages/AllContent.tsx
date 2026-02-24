/**
 * AllContent page - unified view for all content types (bookmarks + notes + prompts).
 *
 * This is the main content page for the app, handling:
 * - All, Archived, Trash views
 * - Custom filters (any content types)
 * - Bookmark add/edit navigation
 * - Note/Prompt navigation with proper return state
 */
import { useCallback, useRef, useMemo, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useContentQuery } from '../hooks/useContentQuery'
import { useContentView } from '../hooks/useContentView'
import { useContentUrlParams } from '../hooks/useContentUrlParams'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
import { useBookmarks } from '../hooks/useBookmarks'
import {
  useDeleteBookmark,
  useRestoreBookmark,
  useArchiveBookmark,
  useUnarchiveBookmark,
  useUpdateBookmark,
} from '../hooks/useBookmarkMutations'
import {
  useDeleteNote,
  useRestoreNote,
  useArchiveNote,
  useUnarchiveNote,
  useUpdateNote,
} from '../hooks/useNoteMutations'
import {
  useDeletePrompt,
  useRestorePrompt,
  useArchivePrompt,
  useUnarchivePrompt,
  useUpdatePrompt,
} from '../hooks/usePromptMutations'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useEffectiveSort, getViewKey } from '../hooks/useEffectiveSort'
import { useTagsStore } from '../stores/tagsStore'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useContentTypeFilterStore, ALL_CONTENT_TYPES } from '../stores/contentTypeFilterStore'
import { useFiltersStore } from '../stores/filtersStore'
import { usePageTitle } from '../hooks/usePageTitle'
import type { PageSize } from '../stores/uiPreferencesStore'
import type { SortByOption } from '../constants/sortOptions'
import { BookmarkCard } from '../components/BookmarkCard'
import { NoteCard } from '../components/NoteCard'
import { PromptCard } from '../components/PromptCard'
import {
  LoadingSpinnerPage,
  ErrorState,
  EmptyState,
  SearchFilterBar,
  SelectedTagsDisplay,
  PaginationControls,
  ContentTypeFilterChips,
  QuickAddMenu,
} from '../components/ui'
import {
  SearchIcon,
  ArchiveIcon,
  TrashIcon,
  ListIcon,
  BookmarkIcon,
  NoteIcon,
  PromptIcon,
} from '../components/icons'
import type { ContentListItem, ContentSearchParams, BookmarkListItem, NoteListItem, PromptListItem, ContentType } from '../types'
import { getFirstGroupTags } from '../utils'

/**
 * AllContent page - unified view for all content types.
 *
 * Features:
 * - List bookmarks and notes together with unified pagination
 * - Search by text (title, description, content)
 * - Filter by tags (AND/OR modes)
 * - Sort by date or title
 * - Bookmark add/edit via page navigation
 * - Note navigation with proper return state
 */
export function AllContent(): ReactNode {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { createReturnState } = useReturnNavigation()

  // URL params for search and pagination (bookmarkable state)
  const { searchQuery, offset, updateParams } = useContentUrlParams()

  // Non-cacheable utilities
  const { trackBookmarkUsage } = useBookmarks()

  // Mutation hooks
  const deleteBookmarkMutation = useDeleteBookmark()
  const restoreBookmarkMutation = useRestoreBookmark()
  const archiveBookmarkMutation = useArchiveBookmark()
  const unarchiveBookmarkMutation = useUnarchiveBookmark()
  const updateBookmarkMutation = useUpdateBookmark()
  const deleteNoteMutation = useDeleteNote()
  const restoreNoteMutation = useRestoreNote()
  const archiveNoteMutation = useArchiveNote()
  const unarchiveNoteMutation = useUnarchiveNote()
  const updateNoteMutation = useUpdateNote()
  const deletePromptMutation = useDeletePrompt()
  const restorePromptMutation = useRestorePrompt()
  const archivePromptMutation = useArchivePrompt()
  const unarchivePromptMutation = useUnarchivePrompt()
  const updatePromptMutation = useUpdatePrompt()

  const { tags: tagSuggestions } = useTagsStore()
  const { pageSize, setPageSize } = useUIPreferencesStore()

  // Tag filters from global store
  const {
    getSelectedTags,
    getTagMatch,
    addTag,
    removeTag,
    setTagMatch,
    clearFilters: clearTagFilters,
  } = useTagFilterStore()

  // Route-based view and filter ID
  const { currentView, currentFilterId } = useContentView('/app/content')

  // View key for tag filters (same logic as content type filter key)
  const tagFilterViewKey = currentFilterId !== undefined ? `filter:${currentFilterId}` : currentView
  const selectedTags = getSelectedTags(tagFilterViewKey)
  const tagMatch = getTagMatch(tagFilterViewKey)

  // Get current filter data for custom filters
  const { filters } = useFiltersStore()
  const currentFilter = useMemo(
    () => currentFilterId !== undefined ? filters.find(f => f.id === currentFilterId) : undefined,
    [currentFilterId, filters]
  )

  // Page title based on view/filter
  const pageTitle = currentFilter?.name
    ?? (currentView === 'archived' ? 'Archived' : currentView === 'deleted' ? 'Trash' : 'All')
  usePageTitle(pageTitle)

  // Content type filter - builtin views always, filters only when multiple types exist
  const { getSelectedTypes, toggleType, clearTypes } = useContentTypeFilterStore()
  const availableContentTypes = useMemo(() => {
    if (currentFilterId === undefined) return ALL_CONTENT_TYPES
    const filterTypes = currentFilter?.content_types
    return filterTypes && filterTypes.length > 0 ? filterTypes : ALL_CONTENT_TYPES
  }, [currentFilterId, currentFilter])
  const contentTypeFilterKey = currentFilterId !== undefined ? `filter:${currentFilterId}` : currentView
  const shouldShowContentTypeFilters = currentFilterId === undefined || availableContentTypes.length > 1
  const selectedContentTypes = shouldShowContentTypeFilters
    ? getSelectedTypes(contentTypeFilterKey, availableContentTypes)
    : undefined

  // Determine if we're showing bookmarks only (hide content type icon in favor of favicon)
  const effectiveContentTypes = selectedContentTypes ?? availableContentTypes
  const isBookmarksOnly = effectiveContentTypes.length === 1 && effectiveContentTypes[0] === 'bookmark'

  // Per-view sort
  const viewKey = useMemo(() => getViewKey(currentView, currentFilterId), [currentView, currentFilterId])
  const filterDefault = useMemo(
    () => currentFilter
      ? {
          sortBy: currentFilter.default_sort_by,
          ascending: currentFilter.default_sort_ascending,
        }
      : undefined,
    [currentFilter]
  )
  const { sortBy, sortOrder, setSort, isOverridden: isSortOverridden, clearOverride: clearSortOverride, availableSortOptions } = useEffectiveSort(
    viewKey,
    currentView,
    filterDefault
  )

  // Get initial tags from current filter's first filter group (for pre-populating new bookmarks)
  const initialTagsFromFilter = useMemo(() => {
    if (!currentFilterId) return undefined
    const filter = filters.find((f) => f.id === currentFilterId)
    return getFirstGroupTags(filter)
  }, [currentFilterId, filters])

  useEffect(() => {
    if (searchParams.get('action') === 'add') {
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('action')
      setSearchParams(newParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onEscape: () => {
      if (document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur()
      }
    },
    onPasteUrl: (url) => {
      if (currentView === 'active') {
        navigate('/app/bookmarks/new', {
          state: {
            ...createReturnState(),
            initialUrl: url,
            initialTags: initialTagsFromFilter,
          },
        })
      }
    },
  })

  // Derive hasFilters from search query, tag store, and content type filter
  const hasContentTypeFilter = selectedContentTypes !== undefined
    && selectedContentTypes.length < availableContentTypes.length
  const hasFilters = searchQuery.length > 0 || selectedTags.length > 0 || hasContentTypeFilter

  // Debounce search query
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)

  // Build search params
  const currentParams: ContentSearchParams = useMemo(
    () => ({
      q: debouncedSearchQuery || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      tag_match: selectedTags.length > 0 ? tagMatch : undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
      offset,
      limit: pageSize,
      view: currentView,
      filter_id: currentFilterId,
      content_types: selectedContentTypes,
    }),
    [debouncedSearchQuery, selectedTags, tagMatch, sortBy, sortOrder, offset, pageSize, currentView, currentFilterId, selectedContentTypes]
  )

  // Fetch content with TanStack Query
  const {
    data: queryData,
    isLoading,
    error: queryError,
    refetch,
  } = useContentQuery(currentParams)

  // Extract data from query result
  const items = queryData?.items ?? []
  const total = queryData?.total ?? 0
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Failed to fetch content') : null

  // Handlers
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateParams({ q: e.target.value, offset: 0 })
    },
    [updateParams]
  )

  const handleTagClick = useCallback(
    (tag: string) => {
      if (!selectedTags.includes(tag)) {
        addTag(tagFilterViewKey, tag)
        updateParams({ offset: 0 })
      }
    },
    [selectedTags, addTag, tagFilterViewKey, updateParams]
  )

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      removeTag(tagFilterViewKey, tagToRemove)
      updateParams({ offset: 0 })
    },
    [removeTag, tagFilterViewKey, updateParams]
  )

  const handleTagMatchChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTagMatch(tagFilterViewKey, e.target.value as 'all' | 'any')
    },
    [setTagMatch, tagFilterViewKey]
  )

  const handleClearTagFilters = useCallback(() => {
    clearTagFilters(tagFilterViewKey)
    updateParams({ offset: 0 })
  }, [clearTagFilters, tagFilterViewKey, updateParams])

  const handleSortChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value
      const [newSortBy, newSortOrder] = value.split('-') as [SortByOption, 'asc' | 'desc']
      setSort(newSortBy, newSortOrder)
    },
    [setSort]
  )

  const handlePageChange = useCallback(
    (newOffset: number) => {
      updateParams({ offset: newOffset })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [updateParams]
  )

  const handlePageSizeChange = useCallback(
    (newSize: PageSize) => {
      setPageSize(newSize)
      updateParams({ offset: 0 })
    },
    [setPageSize, updateParams]
  )

  // Bookmark action handlers
  const handleEditClick = (bookmark: BookmarkListItem): void => {
    navigate(`/app/bookmarks/${bookmark.id}`, { state: createReturnState() })
  }

  const handleDeleteBookmark = async (bookmark: BookmarkListItem): Promise<void> => {
    if (currentView === 'deleted') {
      try {
        await deleteBookmarkMutation.mutateAsync({ id: bookmark.id, permanent: true })
      } catch {
        toast.error('Failed to delete bookmark')
      }
      return
    }

    try {
      await deleteBookmarkMutation.mutateAsync({ id: bookmark.id })
    } catch {
      toast.error('Failed to delete bookmark')
    }
  }

  const handleArchiveBookmark = async (bookmark: BookmarkListItem): Promise<void> => {
    try {
      await archiveBookmarkMutation.mutateAsync(bookmark.id)
    } catch {
      toast.error('Failed to archive bookmark')
    }
  }

  const handleUnarchiveBookmark = async (bookmark: BookmarkListItem): Promise<void> => {
    try {
      await unarchiveBookmarkMutation.mutateAsync(bookmark.id)
    } catch {
      toast.error('Failed to unarchive bookmark')
    }
  }

  const handleRestoreBookmark = async (bookmark: BookmarkListItem): Promise<void> => {
    try {
      await restoreBookmarkMutation.mutateAsync(bookmark.id)
    } catch {
      toast.error('Failed to restore bookmark')
    }
  }

  const handleTagRemoveBookmark = async (bookmark: BookmarkListItem, tag: string): Promise<void> => {
    try {
      const newTags = bookmark.tags.filter((t) => t !== tag)
      await updateBookmarkMutation.mutateAsync({ id: bookmark.id, data: { tags: newTags } })
    } catch {
      toast.error('Failed to remove tag')
    }
  }

  const handleTagAddBookmark = async (bookmark: BookmarkListItem, tag: string): Promise<void> => {
    try {
      const newTags = [...bookmark.tags, tag]
      await updateBookmarkMutation.mutateAsync({ id: bookmark.id, data: { tags: newTags } })
    } catch {
      toast.error('Failed to add tag')
    }
  }

  const handleCancelScheduledArchiveBookmark = async (bookmark: BookmarkListItem): Promise<void> => {
    try {
      await updateBookmarkMutation.mutateAsync({ id: bookmark.id, data: { archived_at: null } })
    } catch {
      toast.error('Failed to cancel scheduled archive')
    }
  }

  // Note action handlers
  const handleViewNote = (note: NoteListItem): void => {
    navigate(`/app/notes/${note.id}`, { state: createReturnState() })
  }

  const handleDeleteNote = async (note: NoteListItem): Promise<void> => {
    if (currentView === 'deleted') {
      try {
        await deleteNoteMutation.mutateAsync({ id: note.id, permanent: true })
      } catch {
        toast.error('Failed to delete note')
      }
      return
    }

    try {
      await deleteNoteMutation.mutateAsync({ id: note.id })
    } catch {
      toast.error('Failed to delete note')
    }
  }

  const handleArchiveNote = async (note: NoteListItem): Promise<void> => {
    try {
      await archiveNoteMutation.mutateAsync(note.id)
    } catch {
      toast.error('Failed to archive note')
    }
  }

  const handleUnarchiveNote = async (note: NoteListItem): Promise<void> => {
    try {
      await unarchiveNoteMutation.mutateAsync(note.id)
    } catch {
      toast.error('Failed to unarchive note')
    }
  }

  const handleRestoreNote = async (note: NoteListItem): Promise<void> => {
    try {
      await restoreNoteMutation.mutateAsync(note.id)
    } catch {
      toast.error('Failed to restore note')
    }
  }

  const handleTagRemoveNote = async (note: NoteListItem, tag: string): Promise<void> => {
    try {
      const newTags = note.tags.filter((t) => t !== tag)
      await updateNoteMutation.mutateAsync({ id: note.id, data: { tags: newTags } })
    } catch {
      toast.error('Failed to remove tag')
    }
  }

  const handleTagAddNote = async (note: NoteListItem, tag: string): Promise<void> => {
    try {
      const newTags = [...note.tags, tag]
      await updateNoteMutation.mutateAsync({ id: note.id, data: { tags: newTags } })
    } catch {
      toast.error('Failed to add tag')
    }
  }

  const handleCancelScheduledArchiveNote = async (note: NoteListItem): Promise<void> => {
    try {
      await updateNoteMutation.mutateAsync({ id: note.id, data: { archived_at: null } })
    } catch {
      toast.error('Failed to cancel scheduled archive')
    }
  }

  // Prompt action handlers
  const handleViewPrompt = (prompt: PromptListItem): void => {
    navigate(`/app/prompts/${prompt.id}`, { state: createReturnState() })
  }

  const handleDeletePrompt = async (prompt: PromptListItem): Promise<void> => {
    if (currentView === 'deleted') {
      try {
        await deletePromptMutation.mutateAsync({ id: prompt.id, permanent: true })
      } catch {
        toast.error('Failed to delete prompt')
      }
      return
    }

    try {
      await deletePromptMutation.mutateAsync({ id: prompt.id })
    } catch {
      toast.error('Failed to delete prompt')
    }
  }

  const handleArchivePrompt = async (prompt: PromptListItem): Promise<void> => {
    try {
      await archivePromptMutation.mutateAsync(prompt.id)
    } catch {
      toast.error('Failed to archive prompt')
    }
  }

  const handleUnarchivePrompt = async (prompt: PromptListItem): Promise<void> => {
    try {
      await unarchivePromptMutation.mutateAsync(prompt.id)
    } catch {
      toast.error('Failed to unarchive prompt')
    }
  }

  const handleRestorePrompt = async (prompt: PromptListItem): Promise<void> => {
    try {
      await restorePromptMutation.mutateAsync(prompt.id)
    } catch {
      toast.error('Failed to restore prompt')
    }
  }

  const handleTagRemovePrompt = async (prompt: PromptListItem, tag: string): Promise<void> => {
    try {
      const newTags = prompt.tags.filter((t) => t !== tag)
      await updatePromptMutation.mutateAsync({ id: prompt.id, data: { tags: newTags } })
    } catch {
      toast.error('Failed to remove tag')
    }
  }

  const handleTagAddPrompt = async (prompt: PromptListItem, tag: string): Promise<void> => {
    try {
      const newTags = [...prompt.tags, tag]
      await updatePromptMutation.mutateAsync({ id: prompt.id, data: { tags: newTags } })
    } catch {
      toast.error('Failed to add tag')
    }
  }

  const handleCancelScheduledArchivePrompt = async (prompt: PromptListItem): Promise<void> => {
    try {
      await updatePromptMutation.mutateAsync({ id: prompt.id, data: { archived_at: null } })
    } catch {
      toast.error('Failed to cancel scheduled archive')
    }
  }

  // Convert ContentListItem to type-specific item for card components
  const toBookmarkListItem = (item: ContentListItem): BookmarkListItem => ({
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
  })

  const toNoteListItem = (item: ContentListItem): NoteListItem => ({
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
  })

  const toPromptListItem = (item: ContentListItem): PromptListItem => ({
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
  })

  // Pagination calculations
  const totalPages = Math.ceil(total / pageSize)
  const currentPage = Math.floor(offset / pageSize) + 1
  const hasMore = offset + items.length < total

  // Quick-add handlers
  const handleQuickAddBookmark = useCallback((): void => {
    navigate('/app/bookmarks/new', { state: { ...createReturnState(), initialTags: initialTagsFromFilter } })
  }, [navigate, createReturnState, initialTagsFromFilter])

  const handleQuickAddNote = useCallback((): void => {
    navigate('/app/notes/new', { state: { ...createReturnState(), initialTags: initialTagsFromFilter } })
  }, [navigate, createReturnState, initialTagsFromFilter])

  const handleQuickAddPrompt = useCallback((): void => {
    navigate('/app/prompts/new', { state: { ...createReturnState(), initialTags: initialTagsFromFilter } })
  }, [navigate, createReturnState, initialTagsFromFilter])

  const contentTypeActions = useMemo<Record<ContentType, {
    pluralLabel: string
    buttonLabel: string
    onClick: () => void
  }>>(() => ({
    bookmark: {
      pluralLabel: 'bookmarks',
      buttonLabel: 'New Bookmark',
      onClick: handleQuickAddBookmark,
    },
    note: {
      pluralLabel: 'notes',
      buttonLabel: 'New Note',
      onClick: handleQuickAddNote,
    },
    prompt: {
      pluralLabel: 'prompts',
      buttonLabel: 'New Prompt',
      onClick: handleQuickAddPrompt,
    },
  }), [handleQuickAddBookmark, handleQuickAddNote, handleQuickAddPrompt])

  // Render content based on state
  const renderContent = (): ReactNode => {
    if (error) {
      return <ErrorState message={error} onRetry={() => refetch()} />
    }

    if (items.length === 0) {
      if (currentView === 'archived') {
        if (hasFilters) {
          return (
            <EmptyState
              icon={<SearchIcon />}
              title="No archived content found"
              description="Try adjusting your search or filter."
            />
          )
        }
        return (
          <EmptyState
            icon={<ArchiveIcon />}
            title="No archived content"
            description="Content you archive will appear here."
          />
        )
      }

      if (currentView === 'deleted') {
        if (hasFilters) {
          return (
            <EmptyState
              icon={<SearchIcon />}
              title="No deleted content found"
              description="Try adjusting your search or filter."
            />
          )
        }
        return (
          <EmptyState
            icon={<TrashIcon />}
            title="Trash is empty"
            description="Items in trash are permanently deleted after 30 days."
          />
        )
      }

      if (hasFilters) {
        return (
          <EmptyState
            icon={<SearchIcon />}
            title="No content found"
            description="Try adjusting your search or filter."
          />
        )
      }

      const typeOrder = ALL_CONTENT_TYPES
      const orderedContentTypes = [...availableContentTypes].sort((left, right) => (
        typeOrder.indexOf(left) - typeOrder.indexOf(right)
      ))
      const isSingleType = orderedContentTypes.length === 1
      const primaryType = isSingleType ? orderedContentTypes[0] : null
      const emptyStateTitle = isSingleType && primaryType
        ? `No ${contentTypeActions[primaryType].pluralLabel} yet`
        : 'No content yet'
      const emptyStateDescription = isSingleType && primaryType
        ? `Create ${contentTypeActions[primaryType].pluralLabel} to see them here.`
        : 'Create content to see it here.'
      const emptyStateActions = orderedContentTypes.map((type) => ({
        label: contentTypeActions[type].buttonLabel,
        onClick: contentTypeActions[type].onClick,
        variant: 'secondary' as const,
      }))
      const emptyStateIcon = isSingleType
        ? (primaryType === 'bookmark'
          ? <BookmarkIcon />
          : primaryType === 'note'
            ? <NoteIcon />
            : primaryType === 'prompt'
              ? <PromptIcon />
              : <ListIcon />)
        : <ListIcon />

      return (
        <EmptyState
          icon={emptyStateIcon}
          title={emptyStateTitle}
          description={emptyStateDescription}
          actions={emptyStateActions}
        />
      )
    }

    return (
      <>
        {/* Content list - reduce side padding on mobile for more card space */}
        <div className="-mx-2 md:mx-0">
          {items.map((item) => {
            if (item.type === 'bookmark') {
              return (
                <BookmarkCard
                  key={`bookmark-${item.id}`}
                  bookmark={toBookmarkListItem(item)}
                  view={currentView}
                  sortBy={sortBy}
                  showContentTypeIcon={!isBookmarksOnly}
                  onEdit={currentView !== 'deleted' ? handleEditClick : undefined}
                  onDelete={handleDeleteBookmark}
                  onArchive={currentView === 'active' ? handleArchiveBookmark : undefined}
                  onUnarchive={currentView === 'archived' ? handleUnarchiveBookmark : undefined}
                  onRestore={currentView === 'deleted' ? handleRestoreBookmark : undefined}
                  onCancelScheduledArchive={currentView === 'active' ? handleCancelScheduledArchiveBookmark : undefined}
                  onTagClick={handleTagClick}
                  onTagRemove={currentView !== 'deleted' ? handleTagRemoveBookmark : undefined}
                  onTagAdd={currentView !== 'deleted' ? handleTagAddBookmark : undefined}
                  tagSuggestions={tagSuggestions}
                  onLinkClick={(b) => trackBookmarkUsage(b.id)}
                />
              )
            }
            if (item.type === 'prompt') {
              return (
                <PromptCard
                  key={`prompt-${item.id}`}
                  prompt={toPromptListItem(item)}
                  view={currentView}
                  sortBy={sortBy}
                  onView={handleViewPrompt}
                  onDelete={handleDeletePrompt}
                  onArchive={currentView === 'active' ? handleArchivePrompt : undefined}
                  onUnarchive={currentView === 'archived' ? handleUnarchivePrompt : undefined}
                  onRestore={currentView === 'deleted' ? handleRestorePrompt : undefined}
                  onCancelScheduledArchive={currentView === 'active' ? handleCancelScheduledArchivePrompt : undefined}
                  onTagClick={handleTagClick}
                  onTagRemove={currentView !== 'deleted' ? handleTagRemovePrompt : undefined}
                  onTagAdd={currentView !== 'deleted' ? handleTagAddPrompt : undefined}
                  tagSuggestions={tagSuggestions}
                />
              )
            }
            return (
              <NoteCard
                key={`note-${item.id}`}
                note={toNoteListItem(item)}
                view={currentView}
                sortBy={sortBy}
                onView={handleViewNote}
                onDelete={handleDeleteNote}
                onArchive={currentView === 'active' ? handleArchiveNote : undefined}
                onUnarchive={currentView === 'archived' ? handleUnarchiveNote : undefined}
                onRestore={currentView === 'deleted' ? handleRestoreNote : undefined}
                onCancelScheduledArchive={currentView === 'active' ? handleCancelScheduledArchiveNote : undefined}
                onTagClick={handleTagClick}
                onTagRemove={currentView !== 'deleted' ? handleTagRemoveNote : undefined}
                onTagAdd={currentView !== 'deleted' ? handleTagAddNote : undefined}
                tagSuggestions={tagSuggestions}
              />
            )
          })}
        </div>

        {/* Pagination */}
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
      </>
    )
  }

  // Content type toggle handler
  const handleContentTypeToggle = useCallback(
    (type: ContentType) => {
      toggleType(contentTypeFilterKey, type, availableContentTypes)
      updateParams({ offset: 0 })
    },
    [toggleType, contentTypeFilterKey, availableContentTypes, updateParams]
  )

  // Reset filters
  const hasNonDefaultFilters = useMemo(() => {
    const hasContentTypeOverride = selectedContentTypes !== undefined
      && selectedContentTypes.length < availableContentTypes.length
    const hasTagFilters = selectedTags.length > 0
    const hasSearchQuery = searchQuery.length > 0
    return hasContentTypeOverride || hasTagFilters || isSortOverridden || hasSearchQuery
  }, [selectedContentTypes, availableContentTypes, selectedTags, isSortOverridden, searchQuery])

  const handleResetFilters = useCallback(() => {
    clearTypes(contentTypeFilterKey)
    clearTagFilters(tagFilterViewKey)
    clearSortOverride()
    updateParams({ q: '', offset: 0 })
  }, [clearTypes, contentTypeFilterKey, clearTagFilters, tagFilterViewKey, clearSortOverride, updateParams])

  // Show quick-add menu for active view (All, or any custom list)
  const showQuickAdd = currentView === 'active'

  if (isLoading) {
    return <LoadingSpinnerPage label="Loading content..." />
  }

  return (
    <div className="pt-3">
      {/* Search and filters */}
      <div className="mb-3 md:mb-5 space-y-3">
        <SearchFilterBar
          searchInputRef={searchInputRef}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          searchPlaceholder="Search all content..."
          tagSuggestions={tagSuggestions}
          selectedTags={selectedTags}
          onTagSelect={handleTagClick}
          sortValue={`${sortBy}-${sortOrder}`}
          onSortChange={handleSortChange}
          availableSortOptions={availableSortOptions}
          leftSlot={
            showQuickAdd ? (
              <QuickAddMenu
                onAddBookmark={handleQuickAddBookmark}
                onAddNote={handleQuickAddNote}
                onAddPrompt={handleQuickAddPrompt}
                contentTypes={currentFilter?.content_types}
              />
            ) : undefined
          }
          hasNonDefaultFilters={hasNonDefaultFilters}
          onReset={handleResetFilters}
        />
        {/* Content type filter chips */}
        {selectedContentTypes && (
          <ContentTypeFilterChips
            selectedTypes={selectedContentTypes}
            availableTypes={availableContentTypes}
            onChange={handleContentTypeToggle}
          />
        )}
        <SelectedTagsDisplay
          selectedTags={selectedTags}
          tagMatch={tagMatch}
          onRemoveTag={handleRemoveTag}
          onTagMatchChange={handleTagMatchChange}
          onClearFilters={handleClearTagFilters}
        />
      </div>

      {/* Content */}
      {renderContent()}

    </div>
  )
}
