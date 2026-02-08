/**
 * Note detail page - handles create and edit modes.
 *
 * Routes:
 * - /app/notes/:id - View/edit note (unified component)
 * - /app/notes/new - Create new note
 */
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Note as NoteComponent } from '../components/Note'
import { HistorySidebar } from '../components/HistorySidebar'
import { LoadingSpinnerCentered, ErrorState } from '../components/ui'
import { useNotes } from '../hooks/useNotes'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
import {
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useRestoreNote,
  useArchiveNote,
  useUnarchiveNote,
} from '../hooks/useNoteMutations'
import { useTagsStore } from '../stores/tagsStore'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import { useHistorySidebarStore } from '../stores/historySidebarStore'
import type { Note as NoteType, NoteCreate, NoteUpdate } from '../types'

type NoteViewState = 'active' | 'archived' | 'deleted'

/**
 * Determine the view state of a note based on its data.
 */
function getNoteViewState(note: NoteType): NoteViewState {
  if (note.deleted_at) return 'deleted'
  if (note.archived_at) return 'archived'
  return 'active'
}

/**
 * NoteDetail handles viewing, editing, and creating notes.
 */
export function NoteDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  // Determine if this is create mode
  const isCreate = !id || id === 'new'
  const noteId = !isCreate ? id : undefined
  const isValidId = noteId !== undefined && noteId.length > 0

  // State
  const [note, setNote] = useState<NoteType | null>(null)
  const [isLoading, setIsLoading] = useState(!isCreate)
  const [error, setError] = useState<string | null>(null)

  // History sidebar state (managed in store so Layout can apply margin)
  const showHistory = useHistorySidebarStore((state) => state.isOpen)
  const setShowHistory = useHistorySidebarStore((state) => state.setOpen)

  // Get navigation state
  const locationState = location.state as { initialTags?: string[]; note?: NoteType } | undefined
  const { selectedTags } = useTagFilterStore()
  const initialTags = locationState?.initialTags ?? (selectedTags.length > 0 ? selectedTags : undefined)
  // Note passed via navigation state (used after create to avoid refetch)
  const passedNote = locationState?.note

  // Navigation
  const { navigateBack } = useReturnNavigation()
  const queryClient = useQueryClient()

  // Hooks
  const { fetchNote, trackNoteUsage } = useNotes()
  const { tags: tagSuggestions } = useTagsStore()
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const createMutation = useCreateNote()
  const updateMutation = useUpdateNote()
  const deleteMutation = useDeleteNote()
  const restoreMutation = useRestoreNote()
  const archiveMutation = useArchiveNote()
  const unarchiveMutation = useUnarchiveNote()

  // Derive view state from note
  const viewState: NoteViewState = note ? getNoteViewState(note) : 'active'

  // Fetch note on mount (for existing notes)
  useEffect(() => {
    if (isCreate) {
      setIsLoading(false)
      return
    }

    if (!isValidId) {
      setError('Invalid note ID')
      setIsLoading(false)
      return
    }

    // If note was passed via navigation state (after create), use it directly
    if (passedNote && passedNote.id === noteId) {
      setNote(passedNote)
      setIsLoading(false)
      trackNoteUsage(noteId!)
      return
    }

    const loadNote = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const fetchedNote = await fetchNote(noteId!)
        setNote(fetchedNote)
        // Track usage when viewing
        trackNoteUsage(noteId!)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load note')
      } finally {
        setIsLoading(false)
      }
    }

    loadNote()
  }, [isCreate, noteId, isValidId, fetchNote, trackNoteUsage, passedNote])

  // Close history sidebar on unmount without persisting to localStorage.
  // This resets Layout margin on navigation, while preserving the open state for page refresh.
  useEffect(() => {
    return () => setShowHistory(false, { persist: false })
  }, [setShowHistory])

  // Navigation helper
  const handleBack = useCallback((): void => {
    navigateBack()
  }, [navigateBack])

  // Action handlers
  const handleSave = useCallback(
    async (data: NoteCreate | NoteUpdate): Promise<void> => {
      if (isCreate) {
        try {
          const createdNote = await createMutation.mutateAsync(data as NoteCreate)
          // Navigate to the new note's URL, passing the note to avoid refetch
          navigate(`/app/notes/${createdNote.id}`, {
            replace: true,
            state: { note: createdNote },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create note'
          toast.error(message)
          throw err
        }
      } else if (noteId) {
        try {
          const updatedNote = await updateMutation.mutateAsync({
            id: noteId,
            data: data as NoteUpdate,
          })
          setNote(updatedNote)
          // Invalidate history cache so sidebar shows latest version when opened
          queryClient.invalidateQueries({ queryKey: ['history', 'note', noteId] })
        } catch (err) {
          // Don't show toast for 409 Conflict - the component handles it with ConflictDialog
          if (axios.isAxiosError(err) && err.response?.status === 409) {
            throw err
          }
          const message = err instanceof Error ? err.message : 'Failed to save note'
          toast.error(message)
          throw err
        }
      }
    },
    [isCreate, noteId, createMutation, updateMutation, navigate, queryClient]
  )

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!noteId) return
    try {
      const archivedNote = await archiveMutation.mutateAsync(noteId)
      setNote(archivedNote)
      navigateBack()
    } catch {
      toast.error('Failed to archive note')
    }
  }, [noteId, archiveMutation, navigateBack])

  const handleUnarchive = useCallback(async (): Promise<void> => {
    if (!noteId) return
    try {
      const unarchivedNote = await unarchiveMutation.mutateAsync(noteId)
      setNote(unarchivedNote)
      navigateBack()
    } catch {
      toast.error('Failed to unarchive note')
    }
  }, [noteId, unarchiveMutation, navigateBack])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!noteId) return
    try {
      const isPermanent = viewState === 'deleted'
      await deleteMutation.mutateAsync({ id: noteId, permanent: isPermanent })
      navigateBack()
    } catch {
      toast.error('Failed to delete note')
    }
  }, [noteId, viewState, deleteMutation, navigateBack])

  const handleRestore = useCallback(async (): Promise<void> => {
    if (!noteId) return
    try {
      const restoredNote = await restoreMutation.mutateAsync(noteId)
      setNote(restoredNote)
      navigateBack()
    } catch {
      toast.error('Failed to restore note')
    }
  }, [noteId, restoreMutation, navigateBack])

  // Refresh handler for stale check - returns true on success, false on failure
  const handleRefresh = useCallback(async (): Promise<NoteType | null> => {
    if (!noteId) return null
    try {
      // skipCache: true ensures we bypass Safari's aggressive caching
      const refreshedNote = await fetchNote(noteId, { skipCache: true })
      setNote(refreshedNote)
      // Invalidate history cache so sidebar shows latest version when opened
      queryClient.invalidateQueries({ queryKey: ['history', 'note', noteId] })
      return refreshedNote
    } catch {
      toast.error('Failed to refresh note')
      return null
    }
  }, [noteId, fetchNote, queryClient])

  // History sidebar handlers
  const handleShowHistory = useCallback((): void => {
    setShowHistory(true)
  }, [setShowHistory])

  const handleHistoryReverted = useCallback(async (): Promise<void> => {
    // Refresh the note after a revert to show the restored content
    if (noteId) {
      const refreshedNote = await fetchNote(noteId, { skipCache: true })
      setNote(refreshedNote)
      toast.success('Note restored to previous version')
    }
  }, [noteId, fetchNote])

  // Render loading state
  if (isLoading) {
    return <LoadingSpinnerCentered label="Loading note..." />
  }

  // Render error state
  if (error) {
    return <ErrorState message={error} onRetry={() => navigate(0)} />
  }

  // Render create mode
  if (isCreate) {
    return (
      <NoteComponent
        key="new"
        tagSuggestions={tagSuggestions}
        onSave={handleSave}
        onClose={handleBack}
        isSaving={createMutation.isPending}
        initialTags={initialTags}
        fullWidth={fullWidthLayout}
      />
    )
  }

  // Render existing note (requires note to be loaded)
  // Use passedNote if note state hasn't been set yet (avoids flash during navigation)
  const effectiveNote = note ?? passedNote
  if (!effectiveNote) {
    return <ErrorState message="Note not found" />
  }

  return (
    <>
      <NoteComponent
        key={effectiveNote.id}
        note={effectiveNote}
        tagSuggestions={tagSuggestions}
        onSave={handleSave}
        onClose={handleBack}
        isSaving={updateMutation.isPending}
        onArchive={viewState === 'active' ? handleArchive : undefined}
        onUnarchive={viewState === 'archived' ? handleUnarchive : undefined}
        onDelete={handleDelete}
        onRestore={viewState === 'deleted' ? handleRestore : undefined}
        viewState={viewState}
        fullWidth={fullWidthLayout}
        onRefresh={handleRefresh}
        onShowHistory={handleShowHistory}
      />
      {showHistory && noteId && (
        <HistorySidebar
          entityType="note"
          entityId={noteId}
          onClose={() => setShowHistory(false)}
          onReverted={handleHistoryReverted}
        />
      )}
    </>
  )
}
