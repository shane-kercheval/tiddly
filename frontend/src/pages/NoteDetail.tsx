/**
 * Note detail page - handles create and edit modes.
 *
 * Route: /app/notes/:id (where id="new" for create, UUID for edit)
 * A single route entry is used intentionally — see App.tsx comment.
 */
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Note as NoteComponent } from '../components/Note'
import { HistorySidebar } from '../components/HistorySidebar'
import { ContentAreaSpinner, ErrorState } from '../components/ui'
import { useNotes } from '../hooks/useNotes'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
import { useLinkedNavigation } from '../hooks/useLinkedNavigation'
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
import { useRightSidebarStore } from '../stores/rightSidebarStore'
import { usePageTitle } from '../hooks/usePageTitle'
import type { Note as NoteType, NoteCreate, NoteUpdate, RelationshipInputPayload } from '../types'
import type { LinkedItem } from '../utils/relationships'
import { isEffectivelyArchived } from '../utils'

type NoteViewState = 'active' | 'archived' | 'deleted'

/**
 * Determine the view state of a note based on its data.
 */
function getNoteViewState(note: NoteType): NoteViewState {
  if (note.deleted_at) return 'deleted'
  if (isEffectivelyArchived(note.archived_at)) return 'archived'
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

  // Right sidebar state (managed in store so Layout can apply margin)
  const showHistory = useRightSidebarStore((state) => state.activePanel === 'history')
  const setActivePanel = useRightSidebarStore((state) => state.setActivePanel)

  // Get navigation state
  const locationState = location.state as {
    initialTags?: string[]
    note?: NoteType
    fromCreate?: boolean
    initialRelationships?: RelationshipInputPayload[]
    initialLinkedItems?: LinkedItem[]
    returnTo?: string
  } | undefined
  // Pre-populate tags from the 'active' view (most common originating context)
  const selectedTags = useTagFilterStore((state) => state.getSelectedTags('active'))
  const initialTags = locationState?.initialTags ?? (selectedTags.length > 0 ? selectedTags : undefined)
  // Note passed via navigation state (used after create to avoid refetch)
  const passedNote = locationState?.note

  // Navigation
  const { navigateBack } = useReturnNavigation()
  const queryClient = useQueryClient()

  // Hooks
  const { fetchNote, trackNoteUsage } = useNotes()
  const handleNavigateToLinked = useLinkedNavigation()
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

  usePageTitle(isCreate ? 'New Note' : note?.title || undefined)

  // Fetch note on mount (for existing notes)
  useEffect(() => {
    if (isCreate) {
      setNote(null)
      setError(null)
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
        trackNoteUsage(noteId!)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load note')
      } finally {
        setIsLoading(false)
      }
    }

    loadNote()
  }, [isCreate, noteId, isValidId, fetchNote, trackNoteUsage, passedNote])

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
          // Preserve returnTo so Close still navigates back to the source entity (e.g. quick-create flow)
          navigate(`/app/notes/${createdNote.id}`, {
            replace: true,
            state: { note: createdNote, fromCreate: true, returnTo: locationState?.returnTo },
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
    [isCreate, noteId, createMutation, updateMutation, navigate, queryClient, locationState?.returnTo]
  )

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!noteId) return
    navigateBack()
    try {
      await archiveMutation.mutateAsync(noteId)
    } catch {
      toast.error('Failed to archive note')
    }
  }, [noteId, archiveMutation, navigateBack])

  const handleUnarchive = useCallback(async (): Promise<void> => {
    if (!noteId) return
    navigateBack()
    try {
      await unarchiveMutation.mutateAsync(noteId)
    } catch {
      toast.error('Failed to unarchive note')
    }
  }, [noteId, unarchiveMutation, navigateBack])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!noteId) return
    navigateBack()
    try {
      await deleteMutation.mutateAsync({ id: noteId, permanent: viewState === 'deleted' })
    } catch {
      toast.error('Failed to delete note')
    }
  }, [noteId, viewState, deleteMutation, navigateBack])

  const handleRestore = useCallback(async (): Promise<void> => {
    if (!noteId) return
    navigateBack()
    try {
      await restoreMutation.mutateAsync(noteId)
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
    setActivePanel('history')
  }, [setActivePanel])

  const handleHistoryRestored = useCallback(async (): Promise<void> => {
    // Refresh the note after a restore to show the restored content
    if (noteId) {
      const refreshedNote = await fetchNote(noteId, { skipCache: true })
      setNote(refreshedNote)
      toast.success('Note restored to previous version')
    }
  }, [noteId, fetchNote])

  // Render loading state
  if (isLoading) {
    return <ContentAreaSpinner label="Loading note..." />
  }

  // Render error state
  if (error) {
    return <ErrorState message={error} onRetry={() => navigate(0)} />
  }

  // Use passedNote if note state hasn't been set yet (avoids flash during navigation)
  const effectiveNote = note ?? passedNote
  if (!isCreate && !effectiveNote) {
    return <ErrorState message="Note not found" />
  }

  // Single render path for both create and edit modes.
  // No key prop — the component stays mounted across the create→edit transition
  // (when onSave navigates from /notes/new to /notes/:id), preserving CodeMirror
  // state (focus, cursor, scroll, undo). Document switching between different
  // existing notes is handled by the sync effect + ContentEditor key inside Note.tsx.
  return (
    <>
      <NoteComponent
        note={effectiveNote ?? undefined}
        tagSuggestions={tagSuggestions}
        onSave={handleSave}
        onClose={handleBack}
        isSaving={createMutation.isPending || updateMutation.isPending}
        initialTags={initialTags}
        onArchive={!isCreate && viewState === 'active' ? handleArchive : undefined}
        onUnarchive={!isCreate && viewState === 'archived' ? handleUnarchive : undefined}
        onDelete={!isCreate ? handleDelete : undefined}
        onRestore={!isCreate && viewState === 'deleted' ? handleRestore : undefined}
        viewState={viewState}
        fullWidth={fullWidthLayout}
        onRefresh={!isCreate ? handleRefresh : undefined}
        onShowHistory={!isCreate ? handleShowHistory : undefined}
        onNavigateToLinked={handleNavigateToLinked}
        initialRelationships={locationState?.initialRelationships}
        initialLinkedItems={locationState?.initialLinkedItems}
        showTocToggle={!isCreate}
        fromCreate={locationState?.fromCreate}
      />
      {showHistory && noteId && (
        <HistorySidebar
          key={`history-${noteId}`}
          entityType="note"
          entityId={noteId}
          onClose={() => setActivePanel(null)}
          onRestored={handleHistoryRestored}
          isDeleted={viewState === 'deleted'}
        />
      )}
    </>
  )
}
