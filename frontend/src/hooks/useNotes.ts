/**
 * Hook for note fetch utilities.
 *
 * These operations bypass React Query caching because:
 * - fetchNote: Used for edit view - always want fresh data, rarely edit same note twice
 * - fetchNoteMetadata: Used for stale checking - always needs fresh data
 * - trackNoteUsage: Fire-and-forget, no caching needed
 *
 * For cached note list queries, see useNotesQuery.
 * For mutations with cache invalidation, see useNoteMutations.
 */
import { useCallback } from 'react'
import { api } from '../services/api'
import type { Note, NoteListItem } from '../types'

/** Options for fetch operations */
interface FetchOptions {
  /**
   * Skip browser cache by adding a cache-bust parameter.
   * Use when you need guaranteed fresh data (e.g., after conflict detection).
   * Required for Safari which aggressively caches despite Cache-Control headers.
   */
  skipCache?: boolean
}

interface UseNotesReturn {
  /** Fetch a single note by ID (with full content for viewing/editing) */
  fetchNote: (id: string, options?: FetchOptions) => Promise<Note>
  /** Fetch note metadata only (lightweight, for stale checking). Defaults to skipCache: true */
  fetchNoteMetadata: (id: string, options?: FetchOptions) => Promise<NoteListItem>
  /** Track note usage (fire-and-forget) */
  trackNoteUsage: (id: string) => void
}

/**
 * Hook for note fetch utilities.
 *
 * @example
 * ```tsx
 * const { fetchNote, fetchNoteMetadata, trackNoteUsage } = useNotes()
 *
 * // Fetch full note for viewing/editing (allows cache)
 * const note = await fetchNote(id)
 *
 * // Fetch full note, bypassing cache (e.g., after conflict)
 * const fresh = await fetchNote(id, { skipCache: true })
 *
 * // Fetch lightweight metadata for stale checking (skips cache by default)
 * const metadata = await fetchNoteMetadata(id)
 *
 * // Track when user views a note
 * trackNoteUsage(id)
 * ```
 */
export function useNotes(): UseNotesReturn {
  const fetchNote = useCallback(async (
    id: string,
    options?: FetchOptions
  ): Promise<Note> => {
    // Cache-bust param forces Safari to fetch fresh data instead of returning stale cache
    const params = options?.skipCache ? { _t: Date.now() } : undefined
    const response = await api.get<Note>(`/notes/${id}`, { params })
    return response.data
  }, [])

  const fetchNoteMetadata = useCallback(async (
    id: string,
    options: FetchOptions = { skipCache: true }
  ): Promise<NoteListItem> => {
    // Default to skipCache: true since this is primarily used for stale detection
    // where fresh data is always needed
    const params = options.skipCache ? { _t: Date.now() } : undefined
    const response = await api.get<NoteListItem>(`/notes/${id}/metadata`, { params })
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
