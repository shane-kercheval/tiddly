/**
 * Bookmark detail page - handles create and edit modes.
 *
 * Routes:
 * - /app/bookmarks/new - Create new bookmark
 * - /app/bookmarks/:id - View/edit bookmark (unified component)
 */
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Bookmark as BookmarkComponent } from '../components/Bookmark'
import { HistorySidebar } from '../components/HistorySidebar'
import { ContentAreaSpinner, ErrorState } from '../components/ui'
import { useBookmarks } from '../hooks/useBookmarks'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
import { useLinkedNavigation } from '../hooks/useLinkedNavigation'
import {
  useCreateBookmark,
  useUpdateBookmark,
  useDeleteBookmark,
  useArchiveBookmark,
  useUnarchiveBookmark,
} from '../hooks/useBookmarkMutations'
import { useTagsStore } from '../stores/tagsStore'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useRightSidebarStore } from '../stores/rightSidebarStore'
import { usePageTitle } from '../hooks/usePageTitle'
import type { Bookmark as BookmarkType, BookmarkCreate, BookmarkUpdate, RelationshipInputPayload } from '../types'
import type { LinkedItem } from '../utils/relationships'
import { getApiErrorMessage, getDomain, isEffectivelyArchived } from '../utils'

type BookmarkViewState = 'active' | 'archived' | 'deleted'

/**
 * Determine the view state of a bookmark based on its data.
 */
function getBookmarkViewState(bookmark: BookmarkType): BookmarkViewState {
  if (bookmark.deleted_at) return 'deleted'
  if (isEffectivelyArchived(bookmark.archived_at)) return 'archived'
  return 'active'
}

/**
 * BookmarkDetail handles creating and editing bookmarks.
 */
export function BookmarkDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  // Determine if this is create mode
  const isCreate = !id || id === 'new'
  const bookmarkId = !isCreate ? id : undefined

  const [bookmark, setBookmark] = useState<BookmarkType | null>(null)
  const [isLoading, setIsLoading] = useState(!isCreate)
  const [error, setError] = useState<string | null>(null)

  // Right sidebar state (managed in store so Layout can apply margin)
  const showHistory = useRightSidebarStore((state) => state.activePanel === 'history')
  const activePanel = useRightSidebarStore((state) => state.activePanel)
  const setActivePanel = useRightSidebarStore((state) => state.setActivePanel)

  // Close ToC panel if active — bookmarks don't support ToC
  useEffect(() => {
    if (activePanel === 'toc') {
      setActivePanel(null)
    }
  }, [activePanel, setActivePanel])

  const locationState = location.state as {
    initialTags?: string[]
    initialUrl?: string
    initialRelationships?: RelationshipInputPayload[]
    initialLinkedItems?: LinkedItem[]
  } | undefined
  // Pre-populate tags from the 'active' view (most common originating context)
  const selectedTags = useTagFilterStore((state) => state.getSelectedTags('active'))
  const initialTags = locationState?.initialTags ?? (selectedTags.length > 0 ? selectedTags : undefined)
  const initialUrl = locationState?.initialUrl

  const { navigateBack } = useReturnNavigation()
  const queryClient = useQueryClient()

  const { fetchBookmark, fetchMetadata } = useBookmarks()
  const handleNavigateToLinked = useLinkedNavigation()
  const { tags: tagSuggestions } = useTagsStore()
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const createMutation = useCreateBookmark()
  const updateMutation = useUpdateBookmark()
  const deleteMutation = useDeleteBookmark()
  const archiveMutation = useArchiveBookmark()
  const unarchiveMutation = useUnarchiveBookmark()

  const viewState: BookmarkViewState = bookmark ? getBookmarkViewState(bookmark) : 'active'

  usePageTitle(
    isCreate
      ? 'New Bookmark'
      : bookmark?.title || (bookmark?.url ? getDomain(bookmark.url) : undefined)
  )

  useEffect(() => {
    if (isCreate) {
      setIsLoading(false)
      return
    }

    if (!bookmarkId) {
      setError('Invalid bookmark ID')
      setIsLoading(false)
      return
    }

    const loadBookmark = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const fetchedBookmark = await fetchBookmark(bookmarkId)
        setBookmark(fetchedBookmark)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bookmark')
      } finally {
        setIsLoading(false)
      }
    }

    loadBookmark()
  }, [isCreate, bookmarkId, fetchBookmark])

  const handleSave = useCallback(
    async (data: BookmarkCreate | BookmarkUpdate): Promise<void> => {
      if (isCreate) {
        try {
          await createMutation.mutateAsync(data as BookmarkCreate)
          navigateBack()
        } catch (err) {
          if (err && typeof err === 'object' && 'response' in err) {
            const axiosError = err as {
              response?: {
                status?: number
                data?: {
                  detail?: string | {
                    message?: string
                    error_code?: string
                    existing_bookmark_id?: string
                  }
                }
              }
            }
            if (axiosError.response?.status === 409) {
              const detail = axiosError.response.data?.detail
              if (typeof detail === 'object' && detail?.error_code === 'ARCHIVED_URL_EXISTS' && detail?.existing_bookmark_id) {
                const archivedId = detail.existing_bookmark_id
                toast.error(
                  (t) => (
                    <span className="flex items-center gap-2">
                      This URL is in your archive.
                      <button
                        onClick={() => {
                          toast.dismiss(t.id)
                          unarchiveMutation.mutateAsync(archivedId)
                            .then(() => {
                              navigateBack()
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
                throw err
              }
              const message = typeof detail === 'string' ? detail : detail?.message || 'A bookmark with this URL already exists'
              toast.error(message)
              throw err
            }
          }
          toast.error(getApiErrorMessage(err, 'Failed to create bookmark'))
          throw err
        }
      } else {
        if (!bookmarkId) return

        try {
          const updatedBookmark = await updateMutation.mutateAsync({
            id: bookmarkId,
            data: data as BookmarkUpdate,
          })
          setBookmark(updatedBookmark)
          // Invalidate history cache so sidebar shows latest version when opened
          queryClient.invalidateQueries({ queryKey: ['history', 'bookmark', bookmarkId] })
        } catch (err) {
          if (err && typeof err === 'object' && 'response' in err) {
            const axiosError = err as { response?: { status?: number; data?: { detail?: string | { error?: string } } } }
            if (axiosError.response?.status === 409) {
              const detail = axiosError.response.data?.detail
              // Version conflict (optimistic locking) - let component handle with ConflictDialog
              if (typeof detail === 'object' && detail?.error === 'conflict') {
                throw err
              }
              // URL conflict - show toast
              const message = typeof detail === 'string' ? detail : 'A bookmark with this URL already exists'
              toast.error(message)
              throw err
            }
          }
          toast.error(getApiErrorMessage(err, 'Failed to save bookmark'))
          throw err
        }
      }
    },
    [isCreate, bookmarkId, createMutation, updateMutation, navigateBack, unarchiveMutation, queryClient]
  )

  const handleClose = useCallback((): void => {
    navigateBack()
  }, [navigateBack])

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!bookmarkId) return
    try {
      const archivedBookmark = await archiveMutation.mutateAsync(bookmarkId)
      setBookmark(archivedBookmark)
      navigateBack()
    } catch {
      toast.error('Failed to archive bookmark')
    }
  }, [bookmarkId, archiveMutation, navigateBack])

  const handleUnarchive = useCallback(async (): Promise<void> => {
    if (!bookmarkId) return
    try {
      const unarchivedBookmark = await unarchiveMutation.mutateAsync(bookmarkId)
      setBookmark(unarchivedBookmark)
      navigateBack()
    } catch {
      toast.error('Failed to restore bookmark')
    }
  }, [bookmarkId, unarchiveMutation, navigateBack])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!bookmarkId) return
    try {
      await deleteMutation.mutateAsync({ id: bookmarkId })
      navigateBack()
    } catch {
      toast.error('Failed to delete bookmark')
    }
  }, [bookmarkId, deleteMutation, navigateBack])

  // Refresh handler for stale check - returns true on success, false on failure
  const handleRefresh = useCallback(async (): Promise<BookmarkType | null> => {
    if (!bookmarkId) return null
    try {
      // skipCache: true ensures we bypass Safari's aggressive caching
      const refreshedBookmark = await fetchBookmark(bookmarkId, { skipCache: true })
      setBookmark(refreshedBookmark)
      // Invalidate history cache so sidebar shows latest version when opened
      queryClient.invalidateQueries({ queryKey: ['history', 'bookmark', bookmarkId] })
      return refreshedBookmark
    } catch {
      toast.error('Failed to refresh bookmark')
      return null
    }
  }, [bookmarkId, fetchBookmark, queryClient])

  // History sidebar handlers
  const handleShowHistory = useCallback((): void => {
    setActivePanel('history')
  }, [setActivePanel])

  const handleHistoryRestored = useCallback(async (): Promise<void> => {
    // Refresh the bookmark after a restore to show the restored content
    if (bookmarkId) {
      const refreshedBookmark = await fetchBookmark(bookmarkId, { skipCache: true })
      setBookmark(refreshedBookmark)
      toast.success('Bookmark restored to previous version')
    }
  }, [bookmarkId, fetchBookmark])

  if (isLoading) {
    return <ContentAreaSpinner label="Loading bookmark..." />
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => navigate(0)} />
  }

  return (
    <>
      <BookmarkComponent
        key={bookmark?.id ?? 'new'}
        bookmark={bookmark ?? undefined}
        tagSuggestions={tagSuggestions}
        onSave={handleSave}
        onClose={handleClose}
        onFetchMetadata={fetchMetadata}
        isSaving={createMutation.isPending || updateMutation.isPending}
        initialUrl={initialUrl}
        initialTags={initialTags}
        onArchive={viewState === 'active' ? handleArchive : undefined}
        onUnarchive={viewState === 'archived' ? handleUnarchive : undefined}
        onDelete={handleDelete}
        viewState={viewState}
        fullWidth={fullWidthLayout}
        onRefresh={handleRefresh}
        onShowHistory={!isCreate ? handleShowHistory : undefined}
        onNavigateToLinked={handleNavigateToLinked}
        initialRelationships={locationState?.initialRelationships}
        initialLinkedItems={locationState?.initialLinkedItems}
      />
      {showHistory && bookmarkId && (
        <HistorySidebar
          key={`history-${bookmarkId}`}
          entityType="bookmark"
          entityId={bookmarkId}
          onClose={() => setActivePanel(null)}
          onRestored={handleHistoryRestored}
          isDeleted={viewState === 'deleted'}
        />
      )}
    </>
  )
}
