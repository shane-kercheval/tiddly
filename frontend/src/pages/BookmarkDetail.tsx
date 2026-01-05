/**
 * Bookmark detail page - handles create and edit modes.
 *
 * Routes:
 * - /app/bookmarks/new - Create new bookmark
 * - /app/bookmarks/:id - Edit bookmark
 * - /app/bookmarks/:id/edit - Edit bookmark
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BookmarkForm } from '../components/BookmarkForm'
import { LoadingSpinnerCentered, ErrorState } from '../components/ui'
import { useBookmarks } from '../hooks/useBookmarks'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
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
import type { Bookmark, BookmarkCreate, BookmarkUpdate } from '../types'
import { getApiErrorMessage } from '../utils'

type PageMode = 'create' | 'edit'
type BookmarkViewState = 'active' | 'archived' | 'deleted'

/**
 * Determine the view state of a bookmark based on its data.
 */
function getBookmarkViewState(bookmark: Bookmark): BookmarkViewState {
  if (bookmark.deleted_at) return 'deleted'
  if (bookmark.archived_at) return 'archived'
  return 'active'
}

/**
 * BookmarkDetail handles creating and editing bookmarks.
 */
export function BookmarkDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const mode: PageMode = useMemo(() => {
    if (!id || id === 'new') return 'create'
    return 'edit'
  }, [id])

  const bookmarkId = mode === 'edit' ? parseInt(id!, 10) : undefined
  const isValidId = bookmarkId !== undefined && !isNaN(bookmarkId)

  const [bookmark, setBookmark] = useState<Bookmark | null>(null)
  const [isLoading, setIsLoading] = useState(mode === 'edit')
  const [error, setError] = useState<string | null>(null)

  const locationState = location.state as { initialTags?: string[]; initialUrl?: string } | undefined
  const { selectedTags } = useTagFilterStore()
  const initialTags = locationState?.initialTags ?? (selectedTags.length > 0 ? selectedTags : undefined)
  const initialUrl = locationState?.initialUrl

  const { navigateBack } = useReturnNavigation()

  const { fetchBookmark, fetchMetadata } = useBookmarks()
  const { tags: tagSuggestions } = useTagsStore()
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const createMutation = useCreateBookmark()
  const updateMutation = useUpdateBookmark()
  const deleteMutation = useDeleteBookmark()
  const archiveMutation = useArchiveBookmark()
  const unarchiveMutation = useUnarchiveBookmark()

  const viewState: BookmarkViewState = bookmark ? getBookmarkViewState(bookmark) : 'active'

  useEffect(() => {
    if (mode === 'create') {
      setIsLoading(false)
      return
    }

    if (!isValidId) {
      setError('Invalid bookmark ID')
      setIsLoading(false)
      return
    }

    const loadBookmark = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const fetchedBookmark = await fetchBookmark(bookmarkId!)
        setBookmark(fetchedBookmark)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load bookmark')
      } finally {
        setIsLoading(false)
      }
    }

    loadBookmark()
  }, [mode, bookmarkId, isValidId, fetchBookmark])

  const handleSubmitCreate = useCallback(
    async (data: BookmarkCreate | BookmarkUpdate): Promise<void> => {
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
                  existing_bookmark_id?: number
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
    },
    [createMutation, navigateBack, unarchiveMutation]
  )

  const handleSubmitUpdate = useCallback(
    async (data: BookmarkCreate | BookmarkUpdate): Promise<void> => {
      if (!bookmarkId) return

      try {
        const updatedBookmark = await updateMutation.mutateAsync({
          id: bookmarkId,
          data: data as BookmarkUpdate,
        })
        setBookmark(updatedBookmark)
        navigateBack()
      } catch (err) {
        if (err && typeof err === 'object' && 'response' in err) {
          const axiosError = err as { response?: { status?: number; data?: { detail?: string } } }
          if (axiosError.response?.status === 409) {
            toast.error(axiosError.response.data?.detail || 'A bookmark with this URL already exists')
            throw err
          }
        }
        toast.error(getApiErrorMessage(err, 'Failed to save bookmark'))
        throw err
      }
    },
    [bookmarkId, updateMutation, navigateBack]
  )

  const handleCancel = useCallback((): void => {
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

  if (isLoading) {
    return <LoadingSpinnerCentered label="Loading bookmark..." />
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => navigate(0)} />
  }

  if (mode === 'create') {
    return (
      <div className={`flex flex-col h-full w-full ${fullWidthLayout ? '' : 'max-w-4xl'}`}>
        <BookmarkForm
          tagSuggestions={tagSuggestions}
          onSubmit={handleSubmitCreate}
          onCancel={handleCancel}
          onFetchMetadata={fetchMetadata}
          isSubmitting={createMutation.isPending}
          initialUrl={initialUrl}
          initialTags={initialTags}
        />
      </div>
    )
  }

  if (!bookmark) {
    return <ErrorState message="Bookmark not found" />
  }

  return (
    <div className={`flex flex-col h-full w-full ${fullWidthLayout ? '' : 'max-w-4xl'}`}>
      <BookmarkForm
        bookmark={bookmark}
        tagSuggestions={tagSuggestions}
        onSubmit={handleSubmitUpdate}
        onCancel={handleCancel}
        onFetchMetadata={fetchMetadata}
        isSubmitting={updateMutation.isPending}
        onArchive={viewState === 'active' ? handleArchive : undefined}
        onUnarchive={viewState === 'archived' ? handleUnarchive : undefined}
        onDelete={handleDelete}
      />
    </div>
  )
}
