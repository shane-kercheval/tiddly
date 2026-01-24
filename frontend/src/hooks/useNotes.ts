/**
 * Hook for non-cacheable note utilities.
 *
 * These operations are not cached because:
 * - fetchNote: Used for edit view - always want fresh data, rarely edit same note twice
 * - trackNoteUsage: Fire-and-forget, no caching needed
 *
 * For cached note list queries, see useNotesQuery.
 * For mutations with cache invalidation, see useNoteMutations.
 */
import { useCallback } from 'react'
import { api } from '../services/api'
import type { Note, NoteListItem } from '../types'

interface UseNotesReturn {
  /** Fetch a single note by ID (with full content for viewing/editing) */
  fetchNote: (id: string) => Promise<Note>
  /** Fetch note metadata only (lightweight, for stale checking) */
  fetchNoteMetadata: (id: string) => Promise<NoteListItem>
  /** Track note usage (fire-and-forget) */
  trackNoteUsage: (id: string) => void
}

/**
 * Hook for non-cacheable note utilities.
 *
 * @example
 * ```tsx
 * const { fetchNote, fetchNoteMetadata, trackNoteUsage } = useNotes()
 *
 * // Fetch full note for viewing/editing
 * const note = await fetchNote(id)
 *
 * // Fetch lightweight metadata (for stale checking)
 * const metadata = await fetchNoteMetadata(id)
 *
 * // Track when user views a note
 * trackNoteUsage(id)
 * ```
 */
export function useNotes(): UseNotesReturn {
  const fetchNote = useCallback(async (id: string): Promise<Note> => {
    const response = await api.get<Note>(`/notes/${id}`)
    return response.data
  }, [])

  const fetchNoteMetadata = useCallback(async (id: string): Promise<NoteListItem> => {
    // Cache-bust to prevent Safari from returning stale cached responses
    const response = await api.get<NoteListItem>(`/notes/${id}/metadata`, {
      params: { _t: Date.now() },
    })
    return response.data
  }, [])

  const trackNoteUsage = useCallback((id: string): void => {
    // Fire-and-forget: no await, no error handling
    // This is non-critical tracking that shouldn't block user navigation
    api.post(`/notes/${id}/track-usage`).catch(() => {
      // Silently ignore errors
    })
  }, [])

  return {
    fetchNote,
    fetchNoteMetadata,
    trackNoteUsage,
  }
}
