/**
 * Tests for useBookmarksQuery hook.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useBookmarksQuery, bookmarkKeys } from './useBookmarksQuery'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

const mockGet = api.get as Mock

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useBookmarksQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('query execution', () => {
    it('should fetch bookmarks with default params', async () => {
      const mockData = {
        items: [{ id: 1, url: 'https://example.com', title: 'Example', tags: [] }],
        total: 1,
        offset: 0,
        limit: 20,
        has_more: false,
      }
      mockGet.mockResolvedValueOnce({ data: mockData })

      const { result } = renderHook(() => useBookmarksQuery({}), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockData)
      expect(mockGet).toHaveBeenCalledWith('/bookmarks/')
    })

    it('should build query string from params', async () => {
      mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } })

      const { result } = renderHook(
        () =>
          useBookmarksQuery({
            q: 'test',
            tags: ['react', 'typescript'],
            tag_match: 'all',
            sort_by: 'created_at',
            sort_order: 'desc',
            offset: 10,
            limit: 20,
            view: 'active',
          }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const calledUrl = mockGet.mock.calls[0][0] as string
      expect(calledUrl).toContain('q=test')
      expect(calledUrl).toContain('tags=react')
      expect(calledUrl).toContain('tags=typescript')
      expect(calledUrl).toContain('tag_match=all')
      expect(calledUrl).toContain('sort_by=created_at')
      expect(calledUrl).toContain('sort_order=desc')
      expect(calledUrl).toContain('offset=10')
      expect(calledUrl).toContain('limit=20')
      expect(calledUrl).toContain('view=active')
    })

    it('should include list_id in query string', async () => {
      mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } })

      const { result } = renderHook(
        () =>
          useBookmarksQuery({
            view: 'active',
            list_id: 123,
          }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const calledUrl = mockGet.mock.calls[0][0] as string
      expect(calledUrl).toContain('list_id=123')
    })

    it('should handle errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useBookmarksQuery({}), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect(result.current.error).toBeInstanceOf(Error)
    })

    it('should not fetch when enabled is false', async () => {
      const { result } = renderHook(
        () => useBookmarksQuery({}, { enabled: false }),
        { wrapper: createWrapper() }
      )

      // Should remain in initial loading state (pending)
      expect(result.current.isPending).toBe(true)
      expect(mockGet).not.toHaveBeenCalled()
    })
  })
})

describe('bookmarkKeys', () => {
  it('should generate correct base key', () => {
    expect(bookmarkKeys.all).toEqual(['bookmarks'])
  })

  it('should generate correct lists key', () => {
    expect(bookmarkKeys.lists()).toEqual(['bookmarks', 'list'])
  })

  it('should generate correct list key with params', () => {
    const params = { view: 'active' as const, q: 'test' }
    expect(bookmarkKeys.list(params)).toEqual(['bookmarks', 'list', params])
  })

  it('should generate correct view-specific keys', () => {
    expect(bookmarkKeys.active()).toEqual(['bookmarks', 'active'])
    expect(bookmarkKeys.archived()).toEqual(['bookmarks', 'archived'])
    expect(bookmarkKeys.deleted()).toEqual(['bookmarks', 'deleted'])
  })
})
