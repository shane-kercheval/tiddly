/**
 * AllContent page - unified view for all content types (bookmarks + notes).
 *
 * This is the main content page for the app, handling:
 * - All, Archived, Trash views
 * - Custom lists (any content types)
 * - Bookmark add/edit modals
 * - Note navigation with proper return state
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useContentQuery } from '../hooks/useContentQuery'
import { useContentView } from '../hooks/useContentView'
import { useContentUrlParams } from '../hooks/useContentUrlParams'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
import { useBookmarks } from '../hooks/useBookmarks'
import {
  useCreateBookmark,
  useUpdateBookmark,
  useDeleteBookmark,
  useRestoreBookmark,
  useArchiveBookmark,
  useUnarchiveBookmark,
} from '../hooks/useBookmarkMutations'
import {
  useDeleteNote,
  useRestoreNote,
  useArchiveNote,
  useUnarchiveNote,
} from '../hooks/useNoteMutations'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useEffectiveSort, getViewKey } from '../hooks/useEffectiveSort'
import { useTagsStore } from '../stores/tagsStore'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useContentTypeFilterStore, ALL_CONTENT_TYPES } from '../stores/contentTypeFilterStore'
import { useListsStore } from '../stores/listsStore'
import type { PageSize } from '../stores/uiPreferencesStore'
import type { SortByOption } from '../constants/sortOptions'
import { BookmarkCard } from '../components/BookmarkCard'
import { BookmarkModal } from '../components/BookmarkModal'
import { NoteCard } from '../components/NoteCard'
import {
  LoadingSpinnerCentered,
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
} from '../components/icons'
import type { Bookmark, BookmarkCreate, BookmarkUpdate, ContentListItem, ContentSearchParams, BookmarkListItem, NoteListItem, ContentType } from '../types'
import { getFirstGroupTags } from '../utils'

/**
 * AllContent page - unified view for all content types.
 *
 * Features:
 * - List bookmarks and notes together with unified pagination
 * - Search by text (title, description, content)
 * - Filter by tags (AND/OR modes)
 * - Sort by date or title
 * - Bookmark add/edit via modal
 * - Note navigation with proper return state
 */
export function AllContent(): ReactNode {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { createReturnState } = useReturnNavigation()

  // URL params for search and pagination (bookmarkable state)
  const { searchQuery, offset, updateParams } = useContentUrlParams()

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pastedUrl, setPastedUrl] = useState<string | undefined>(undefined)
  const [loadingBookmarkId, setLoadingBookmarkId] = useState<number | null>(null)

  // Non-cacheable utilities
  const { fetchBookmark, fetchMetadata, trackBookmarkUsage } = useBookmarks()

  // Mutation hooks
  const createBookmarkMutation = useCreateBookmark()
  const updateBookmarkMutation = useUpdateBookmark()
  const deleteBookmarkMutation = useDeleteBookmark()
  const restoreBookmarkMutation = useRestoreBookmark()
  const archiveBookmarkMutation = useArchiveBookmark()
  const unarchiveBookmarkMutation = useUnarchiveBookmark()
  const deleteNoteMutation = useDeleteNote()
  const restoreNoteMutation = useRestoreNote()
  const archiveNoteMutation = useArchiveNote()
  const unarchiveNoteMutation = useUnarchiveNote()

  const { tags: tagSuggestions } = useTagsStore()
  const { pageSize, setPageSize } = useUIPreferencesStore()

  // Tag filters from global store
  const {
    selectedTags,
    tagMatch,
    addTag,
    removeTag,
    setTagMatch,
    clearFilters: clearTagFilters,
  } = useTagFilterStore()

  // Route-based view and list ID
  const { currentView, currentListId } = useContentView('/app/content')

  // Get current list data for custom lists
  const { lists } = useListsStore()
  const currentList = useMemo(
    () => currentListId !== undefined ? lists.find(l => l.id === currentListId) : undefined,
    [currentListId, lists]
  )

  // Content type filter - builtin views always, lists only when multiple types exist
  const { getSelectedTypes, toggleType } = useContentTypeFilterStore()
  const availableContentTypes = useMemo(() => {
    if (currentListId === undefined) return ALL_CONTENT_TYPES
    const listTypes = currentList?.content_types
    return listTypes && listTypes.length > 0 ? listTypes : ALL_CONTENT_TYPES
  }, [currentListId, currentList])
  const contentTypeFilterKey = currentListId !== undefined ? `list:${currentListId}` : currentView
  const shouldShowContentTypeFilters = currentListId === undefined || availableContentTypes.length > 1
  const selectedContentTypes = shouldShowContentTypeFilters
    ? getSelectedTypes(contentTypeFilterKey, availableContentTypes)
    : undefined

  // Per-view sort
  const viewKey = useMemo(() => getViewKey(currentView, currentListId), [currentView, currentListId])
  const { sortBy, sortOrder, setSort, availableSortOptions } = useEffectiveSort(
    viewKey,
    currentView,
    undefined
  )

  // Get initial tags from current list's first filter group (for pre-populating new bookmarks)
  const initialTagsFromList = useMemo(() => {
    if (!currentListId) return undefined
    const list = lists.find((l) => l.id === currentListId)
    return getFirstGroupTags(list)
  }, [currentListId, lists])

  // Check for action=add query param to auto-open add modal
  useEffect(() => {
    if (searchParams.get('action') === 'add') {
      setShowAddModal(true)
      // Remove the action param from URL
      const newParams = new URLSearchParams(searchParams)
      newParams.delete('action')
      setSearchParams(newParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Helper to close add modal
  const closeAddModal = useCallback((): void => {
    setShowAddModal(false)
    setPastedUrl(undefined)
  }, [])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNewBookmark: () => {
      if (currentView === 'active') {
        setShowAddModal(true)
      }
    },
    onFocusSearch: () => searchInputRef.current?.focus(),
    onEscape: () => {
      if (showAddModal) closeAddModal()
      else if (editingBookmark) setEditingBookmark(null)
      else if (document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur()
      }
    },
    onPasteUrl: (url) => {
      if (currentView === 'active') {
        setPastedUrl(url)
        setShowAddModal(true)
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
      list_id: currentListId,
      content_types: selectedContentTypes,
    }),
    [debouncedSearchQuery, selectedTags, tagMatch, sortBy, sortOrder, offset, pageSize, currentView, currentListId, selectedContentTypes]
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
        addTag(tag)
        updateParams({ offset: 0 })
      }
    },
    [selectedTags, addTag, updateParams]
  )

  const handleRemoveTag = useCallback(
    (tagToRemove: string) => {
      removeTag(tagToRemove)
      updateParams({ offset: 0 })
    },
    [removeTag, updateParams]
  )

  const handleTagMatchChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTagMatch(e.target.value as 'all' | 'any')
    },
    [setTagMatch]
  )

  const handleClearTagFilters = useCallback(() => {
    clearTagFilters()
    updateParams({ offset: 0 })
  }, [clearTagFilters, updateParams])

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
  const handleEditClick = async (bookmark: BookmarkListItem): Promise<void> => {
    if (loadingBookmarkId === bookmark.id) return
    setLoadingBookmarkId(bookmark.id)
    try {
      const fullBookmark = await fetchBookmark(bookmark.id)
      setEditingBookmark(fullBookmark)
    } catch {
      toast.error('Failed to load bookmark')
    } finally {
      setLoadingBookmarkId(null)
    }
  }

  const handleAddBookmark = async (data: BookmarkCreate | BookmarkUpdate): Promise<void> => {
    setIsSubmitting(true)
    try {
      await createBookmarkMutation.mutateAsync(data as BookmarkCreate)
      closeAddModal()
    } catch (err) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as {
          response?: {
            status?: number
            data?: {
              detail?: string | {
                message?: string
                error_code?: string
                existing_bookmark_id?: number
              }
            }
          }
        }
        if (axiosError.response?.status === 409) {
          const detail = axiosError.response.data?.detail
          if (typeof detail === 'object' && detail?.error_code === 'ARCHIVED_URL_EXISTS' && detail?.existing_bookmark_id) {
            const bookmarkId = detail.existing_bookmark_id
            toast.error(
              (t) => (
                <span className="flex items-center gap-2">
                  This URL is in your archive.
                  <button
                    onClick={() => {
                      toast.dismiss(t.id)
                      unarchiveBookmarkMutation.mutateAsync(bookmarkId)
                        .then(() => {
                          closeAddModal()
                          toast.success('Bookmark unarchived')
                        })
                        .catch(() => {
                          toast.error('Failed to unarchive bookmark')
                        })
                    }}
                    className="font-medium underline"
                  >
                    Unarchive
                  </button>
                </span>
              ),
              { duration: 8000 }
            )
          } else {
            const message = typeof detail === 'string' ? detail : detail?.message || 'A bookmark with this URL already exists'
            toast.error(message)
          }
          throw err
        }
      }
      toast.error('Failed to add bookmark')
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEditBookmark = async (data: BookmarkCreate | BookmarkUpdate): Promise<void> => {
    if (!editingBookmark) return
    setIsSubmitting(true)
    try {
      await updateBookmarkMutation.mutateAsync({ id: editingBookmark.id, data: data as BookmarkUpdate })
      setEditingBookmark(null)
    } catch (err) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as { response?: { status?: number; data?: { detail?: string } } }
        if (axiosError.response?.status === 409) {
          toast.error(axiosError.response.data?.detail || 'A bookmark with this URL already exists')
          throw err
        }
      }
      toast.error('Failed to update bookmark')
      throw err
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFetchMetadata = async (url: string): Promise<{
    title: string | null
    description: string | null
    content: string | null
    error: string | null
  }> => {
    const result = await fetchMetadata(url)
    return {
      title: result.title,
      description: result.description,
      content: result.content,
      error: result.error,
    }
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
      toast.success(
        (t) => (
          <span className="flex items-center gap-2">
            Bookmark deleted.
            <button
              onClick={() => {
                toast.dismiss(t.id)
                restoreBookmarkMutation.mutateAsync(bookmark.id)
                  .catch(() => toast.error("Couldn't undo"))
              }}
              className="font-medium underline"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 5000 }
      )
    } catch {
      toast.error('Failed to delete bookmark')
    }
  }

  const handleArchiveBookmark = async (bookmark: BookmarkListItem): Promise<void> => {
    try {
      await archiveBookmarkMutation.mutateAsync(bookmark.id)
      toast.success(
        (t) => (
          <span className="flex items-center gap-2">
            Bookmark archived.
            <button
              onClick={() => {
                toast.dismiss(t.id)
                unarchiveBookmarkMutation.mutateAsync(bookmark.id)
                  .catch(() => toast.error("Couldn't undo"))
              }}
              className="font-medium underline"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 5000 }
      )
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

  // Note action handlers
  const handleViewNote = (note: NoteListItem): void => {
    navigate(`/app/notes/${note.id}`, { state: createReturnState() })
  }

  const handleEditNote = (note: NoteListItem): void => {
    navigate(`/app/notes/${note.id}/edit`, { state: createReturnState() })
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
      toast.success(
        (t) => (
          <span className="flex items-center gap-2">
            Note deleted.
            <button
              onClick={() => {
                toast.dismiss(t.id)
                restoreNoteMutation.mutateAsync(note.id)
                  .catch(() => toast.error("Couldn't undo"))
              }}
              className="font-medium underline"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 5000 }
      )
    } catch {
      toast.error('Failed to delete note')
    }
  }

  const handleArchiveNote = async (note: NoteListItem): Promise<void> => {
    try {
      await archiveNoteMutation.mutateAsync(note.id)
      toast.success(
        (t) => (
          <span className="flex items-center gap-2">
            Note archived.
            <button
              onClick={() => {
                toast.dismiss(t.id)
                unarchiveNoteMutation.mutateAsync(note.id)
                  .catch(() => toast.error("Couldn't undo"))
              }}
              className="font-medium underline"
            >
              Undo
            </button>
          </span>
        ),
        { duration: 5000 }
      )
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
  })

  // Pagination calculations
  const totalPages = Math.ceil(total / pageSize)
  const currentPage = Math.floor(offset / pageSize) + 1
  const hasMore = offset + items.length < total

  // Render content based on state
  const renderContent = (): ReactNode => {
    if (isLoading) {
      return <LoadingSpinnerCentered label="Loading content..." />
    }

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

      return (
        <EmptyState
          icon={<ListIcon />}
          title="No content yet"
          description="Create bookmarks or notes to see them here."
        />
      )
    }

    return (
      <>
        {/* Content list */}
        <div>
          {items.map((item) => (
            item.type === 'bookmark' ? (
              <BookmarkCard
                key={`bookmark-${item.id}`}
                bookmark={toBookmarkListItem(item)}
                view={currentView}
                sortBy={sortBy}
                onEdit={currentView !== 'deleted' ? handleEditClick : undefined}
                onDelete={handleDeleteBookmark}
                onArchive={currentView === 'active' ? handleArchiveBookmark : undefined}
                onUnarchive={currentView === 'archived' ? handleUnarchiveBookmark : undefined}
                onRestore={currentView === 'deleted' ? handleRestoreBookmark : undefined}
                onTagClick={handleTagClick}
                onLinkClick={(b) => trackBookmarkUsage(b.id)}
                isLoading={loadingBookmarkId === item.id}
              />
            ) : (
              <NoteCard
                key={`note-${item.id}`}
                note={toNoteListItem(item)}
                view={currentView}
                sortBy={sortBy}
                onView={handleViewNote}
                onEdit={currentView !== 'deleted' ? handleEditNote : undefined}
                onDelete={handleDeleteNote}
                onArchive={currentView === 'active' ? handleArchiveNote : undefined}
                onUnarchive={currentView === 'archived' ? handleUnarchiveNote : undefined}
                onRestore={currentView === 'deleted' ? handleRestoreNote : undefined}
                onTagClick={handleTagClick}
              />
            )
          ))}
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

  // Quick-add handlers
  const handleQuickAddBookmark = useCallback((): void => {
    setShowAddModal(true)
  }, [])

  const handleQuickAddNote = useCallback((): void => {
    navigate('/app/notes/new', { state: { ...createReturnState(), initialTags: initialTagsFromList } })
  }, [navigate, createReturnState, initialTagsFromList])

  // Show quick-add menu for active view (All, or any custom list)
  const showQuickAdd = currentView === 'active'

  return (
    <div>
      {/* Search and filters */}
      <div className="mb-6 space-y-3">
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
                contentTypes={currentList?.content_types}
              />
            ) : undefined
          }
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

      {/* Add bookmark modal */}
      <BookmarkModal
        isOpen={showAddModal}
        onClose={closeAddModal}
        tagSuggestions={tagSuggestions}
        onSubmit={handleAddBookmark}
        onFetchMetadata={handleFetchMetadata}
        isSubmitting={isSubmitting}
        initialUrl={pastedUrl}
        initialTags={initialTagsFromList}
      />

      {/* Edit bookmark modal */}
      <BookmarkModal
        isOpen={!!editingBookmark}
        onClose={() => setEditingBookmark(null)}
        bookmark={editingBookmark || undefined}
        tagSuggestions={tagSuggestions}
        onSubmit={handleEditBookmark}
        onFetchMetadata={handleFetchMetadata}
        isSubmitting={isSubmitting}
      />
    </div>
  )
}
