/**
 * AllContent page - unified view for all content types (bookmarks + notes).
 *
 * Used for the shared views: All, Archived, Trash, and custom shared lists.
 * Displays both bookmarks and notes in a single unified list.
 */
import { useCallback, useRef, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useContentQuery } from '../hooks/useContentQuery'
import { useContentView } from '../hooks/useContentView'
import { useContentUrlParams } from '../hooks/useContentUrlParams'
import { useBookmarks } from '../hooks/useBookmarks'
import {
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
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useEffectiveSort, getViewKey } from '../hooks/useEffectiveSort'
import { useTagsStore } from '../stores/tagsStore'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useContentTypeFilterStore } from '../stores/contentTypeFilterStore'
import { useListsStore } from '../stores/listsStore'
import type { PageSize } from '../stores/uiPreferencesStore'
import type { SortByOption } from '../constants/sortOptions'
import { BookmarkCard } from '../components/BookmarkCard'
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
  SharedIcon,
} from '../components/icons'
import type { ContentListItem, ContentSearchParams, BookmarkListItem, NoteListItem } from '../types'

/**
 * AllContent page - unified view for all content types.
 *
 * Features:
 * - List bookmarks and notes together with unified pagination
 * - Search by text (title, description, content)
 * - Filter by tags (AND/OR modes)
 * - Sort by date or title
 * - Navigate to edit pages for individual items
 */
export function AllContent(): ReactNode {
  const navigate = useNavigate()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // URL params for search and pagination (bookmarkable state)
  const { searchQuery, offset, updateParams } = useContentUrlParams()

  // Non-cacheable utilities
  const { trackBookmarkUsage } = useBookmarks()

  // Mutation hooks
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

  // Content type filter - only for builtin views (not custom lists)
  const { getSelectedTypes, toggleType } = useContentTypeFilterStore()
  const selectedContentTypes = currentListId === undefined ? getSelectedTypes(currentView) : undefined

  // Per-view sort
  const viewKey = useMemo(() => getViewKey(currentView, currentListId), [currentView, currentListId])
  const { sortBy, sortOrder, setSort, availableSortOptions } = useEffectiveSort(
    viewKey,
    currentView,
    undefined
  )

  // Derive hasFilters from search query, tag store, and content type filter
  const hasContentTypeFilter = selectedContentTypes !== undefined && selectedContentTypes.length < 2
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
  const handleEditBookmark = (bookmark: BookmarkListItem): void => {
    navigate(`/app/bookmarks/${bookmark.id}/edit`)
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
    navigate(`/app/notes/${note.id}`)
  }

  const handleEditNote = (note: NoteListItem): void => {
    navigate(`/app/notes/${note.id}/edit`)
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
          icon={<SharedIcon />}
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
                onEdit={currentView !== 'deleted' ? handleEditBookmark : undefined}
                onDelete={handleDeleteBookmark}
                onArchive={currentView === 'active' ? handleArchiveBookmark : undefined}
                onUnarchive={currentView === 'archived' ? handleUnarchiveBookmark : undefined}
                onRestore={currentView === 'deleted' ? handleRestoreBookmark : undefined}
                onTagClick={handleTagClick}
                onLinkClick={(b) => trackBookmarkUsage(b.id)}
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
    (type: 'bookmark' | 'note') => {
      toggleType(currentView, type)
      updateParams({ offset: 0 })
    },
    [toggleType, currentView, updateParams]
  )

  // Quick-add handlers
  const handleQuickAddBookmark = useCallback((): void => {
    navigate('/app/bookmarks?action=add')
  }, [navigate])

  const handleQuickAddNote = useCallback((): void => {
    navigate('/app/notes/new')
  }, [navigate])

  // Show quick-add menu for active view:
  // - "All" view (no list selected)
  // - Custom lists (we'll pass their content_types to filter options)
  const showQuickAdd = currentView === 'active' && (
    !currentListId || currentList !== undefined
  )

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
        {/* Content type filter chips - only for builtin views */}
        {selectedContentTypes && (
          <ContentTypeFilterChips
            selectedTypes={selectedContentTypes}
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
