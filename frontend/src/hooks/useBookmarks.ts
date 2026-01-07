/**
 * Hook for non-cacheable bookmark utilities.
 *
 * These operations are not cached because:
 * - fetchBookmark: Used for edit modal - always want fresh data, rarely edit same bookmark twice
 * - fetchMetadata: URL preview - unique URLs, no benefit from caching
 * - trackBookmarkUsage: Fire-and-forget, no caching needed
 *
 * For cached bookmark list queries, see useBookmarksQuery.
 * For mutations with cache invalidation, see useBookmarkMutations.
 */
import { useCallback } from 'react'
import { api } from '../services/api'
import type { Bookmark, MetadataPreviewResponse } from '../types'

interface UseBookmarksReturn {
  /** Fetch a single bookmark by ID (with full content for editing) */
  fetchBookmark: (id: string) => Promise<Bookmark>
  /** Fetch metadata preview for a URL */
  fetchMetadata: (url: string) => Promise<MetadataPreviewResponse>
  /** Track bookmark usage (fire-and-forget) */
  trackBookmarkUsage: (id: string) => void
}

/**
 * Hook for non-cacheable bookmark utilities.
 *
 * @example
 * ```tsx
 * const { fetchBookmark, fetchMetadata, trackBookmarkUsage } = useBookmarks()
 *
 * // Fetch full bookmark for editing
 * const bookmark = await fetchBookmark(id)
 *
 * // Preview URL metadata in form
 * const metadata = await fetchMetadata(url)
 *
 * // Track when user clicks a bookmark link
 * trackBookmarkUsage(id)
 * ```
 */
export function useBookmarks(): UseBookmarksReturn {
  const fetchBookmark = useCallback(async (id: string): Promise<Bookmark> => {
    const response = await api.get<Bookmark>(`/bookmarks/${id}`)
    return response.data
  }, [])

  const fetchMetadata = useCallback(async (url: string): Promise<MetadataPreviewResponse> => {
    const response = await api.get<MetadataPreviewResponse>('/bookmarks/fetch-metadata', {
      params: { url, include_content: true },
    })
    return response.data
  }, [])

  const trackBookmarkUsage = useCallback((id: string): void => {
    // Fire-and-forget: no await, no error handling
    // This is non-critical tracking that shouldn't block user navigation
    api.post(`/bookmarks/${id}/track-usage`).catch(() => {
      // Silently ignore errors
    })
  }, [])

  return {
    fetchBookmark,
    fetchMetadata,
    trackBookmarkUsage,
  }
}
