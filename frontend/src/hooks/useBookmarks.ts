/**
 * Hook for bookmark fetch utilities.
 *
 * These operations bypass React Query caching because:
 * - fetchBookmark: Used for edit modal - always want fresh data, rarely edit same bookmark twice
 * - fetchBookmarkMetadata: Used for stale checking - always needs fresh data
 * - fetchMetadata: URL preview - unique URLs, no benefit from caching
 * - trackBookmarkUsage: Fire-and-forget, no caching needed
 *
 * For cached bookmark list queries, see useBookmarksQuery.
 * For mutations with cache invalidation, see useBookmarkMutations.
 */
import { useCallback } from 'react'
import { api } from '../services/api'
import type { Bookmark, BookmarkListItem, MetadataPreviewResponse } from '../types'

/** Options for fetch operations */
interface FetchOptions {
  /**
   * Skip browser cache by adding a cache-bust parameter.
   * Use when you need guaranteed fresh data (e.g., after conflict detection).
   * Required for Safari which aggressively caches despite Cache-Control headers.
   */
  skipCache?: boolean
}

interface UseBookmarksReturn {
  /** Fetch a single bookmark by ID (with full content for editing) */
  fetchBookmark: (id: string, options?: FetchOptions) => Promise<Bookmark>
  /** Fetch bookmark metadata only (lightweight, for stale checking). Defaults to skipCache: true */
  fetchBookmarkMetadata: (id: string, options?: FetchOptions) => Promise<BookmarkListItem>
  /** Fetch metadata preview for a URL */
  fetchMetadata: (url: string) => Promise<MetadataPreviewResponse>
  /** Track bookmark usage (fire-and-forget) */
  trackBookmarkUsage: (id: string) => void
}

/**
 * Hook for bookmark fetch utilities.
 *
 * @example
 * ```tsx
 * const { fetchBookmark, fetchBookmarkMetadata, fetchMetadata, trackBookmarkUsage } = useBookmarks()
 *
 * // Fetch full bookmark for editing (allows cache)
 * const bookmark = await fetchBookmark(id)
 *
 * // Fetch full bookmark, bypassing cache (e.g., after conflict)
 * const fresh = await fetchBookmark(id, { skipCache: true })
 *
 * // Fetch lightweight metadata for stale checking (skips cache by default)
 * const metadata = await fetchBookmarkMetadata(id)
 *
 * // Preview URL metadata in form
 * const preview = await fetchMetadata(url)
 *
 * // Track when user clicks a bookmark link
 * trackBookmarkUsage(id)
 * ```
 */
export function useBookmarks(): UseBookmarksReturn {
  const fetchBookmark = useCallback(async (
    id: string,
    options?: FetchOptions
  ): Promise<Bookmark> => {
    // Cache-bust param forces Safari to fetch fresh data instead of returning stale cache
    const params = options?.skipCache ? { _t: Date.now() } : undefined
    const response = await api.get<Bookmark>(`/bookmarks/${id}`, { params })
    return response.data
  }, [])

  const fetchBookmarkMetadata = useCallback(async (
    id: string,
    options: FetchOptions = { skipCache: true }
  ): Promise<BookmarkListItem> => {
    // Default to skipCache: true since this is primarily used for stale detection
    // where fresh data is always needed
    const params = options.skipCache ? { _t: Date.now() } : undefined
    const response = await api.get<BookmarkListItem>(`/bookmarks/${id}/metadata`, { params })
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
    fetchBookmarkMetadata,
    fetchMetadata,
    trackBookmarkUsage,
  }
}
