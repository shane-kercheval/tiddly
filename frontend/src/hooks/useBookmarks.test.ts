/**
 * Tests for useBookmarks hook (non-cacheable utilities).
 *
 * For query tests, see useBookmarksQuery.test.ts.
 * For mutation tests, see useBookmarkMutations.test.ts.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBookmarks } from './useBookmarks'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

const mockGet = api.get as Mock
const mockPost = api.post as Mock

describe('useBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchBookmark', () => {
    it('should fetch a single bookmark by ID', async () => {
      const mockBookmark = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        description: 'A test bookmark',
        content: 'Full page content here',
        tags: ['test'],
      }
      mockGet.mockResolvedValueOnce({ data: mockBookmark })

      const { result } = renderHook(() => useBookmarks())

      let fetched: unknown
      await act(async () => {
        fetched = await result.current.fetchBookmark('1')
      })

      expect(fetched).toEqual(mockBookmark)
      expect(mockGet).toHaveBeenCalledWith('/bookmarks/1', { params: undefined })
    })

    it('should fetch bookmark with skipCache option', async () => {
      const mockBookmark = {
        id: 1,
        url: 'https://example.com',
        title: 'Example',
        description: 'A test bookmark',
        content: 'Full page content here',
        tags: ['test'],
      }
      mockGet.mockResolvedValueOnce({ data: mockBookmark })

      const { result } = renderHook(() => useBookmarks())

      await act(async () => {
        await result.current.fetchBookmark('1', { skipCache: true })
      })

      // Should include cache-busting _t param
      expect(mockGet).toHaveBeenCalledWith('/bookmarks/1', {
        params: expect.objectContaining({ _t: expect.any(Number) }),
      })
    })

    it('should throw error on fetch failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Not found'))

      const { result } = renderHook(() => useBookmarks())

      await expect(result.current.fetchBookmark('999')).rejects.toThrow('Not found')
    })
  })

  describe('fetchMetadata', () => {
    it('should fetch metadata for a URL', async () => {
      const mockMetadata = {
        url: 'https://example.com',
        final_url: 'https://example.com/',
        title: 'Example Site',
        description: 'A sample site',
        content: 'Full page content',
        error: null,
      }
      mockGet.mockResolvedValueOnce({ data: mockMetadata })

      const { result } = renderHook(() => useBookmarks())

      let metadata: unknown
      await act(async () => {
        metadata = await result.current.fetchMetadata('https://example.com')
      })

      expect(metadata).toEqual(mockMetadata)
      expect(mockGet).toHaveBeenCalledWith('/bookmarks/fetch-metadata', {
        params: { url: 'https://example.com', include_content: true },
      })
    })

    it('should throw error on metadata fetch failure', async () => {
      mockGet.mockRejectedValueOnce(new Error('Rate limited'))

      const { result } = renderHook(() => useBookmarks())

      await expect(result.current.fetchMetadata('https://example.com')).rejects.toThrow(
        'Rate limited'
      )
    })
  })

  describe('trackBookmarkUsage', () => {
    it('should call track-usage endpoint (fire-and-forget)', async () => {
      mockPost.mockResolvedValueOnce({})

      const { result } = renderHook(() => useBookmarks())

      act(() => {
        result.current.trackBookmarkUsage('1')
      })

      expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/track-usage')
    })

    it('should silently ignore errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Server error'))

      const { result } = renderHook(() => useBookmarks())

      // Should not throw
      act(() => {
        result.current.trackBookmarkUsage('1')
      })

      expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/track-usage')
    })
  })
})
