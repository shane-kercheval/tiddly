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

    it('should build multi-value view query string', async () => {
      mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } })

      const { result } = renderHook(
        () =>
          useBookmarksQuery({
            view: ['active', 'archived'],
          }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const calledUrl = mockGet.mock.calls[0][0] as string
      expect(calledUrl).toContain('view=active')
      expect(calledUrl).toContain('view=archived')
    })

    it('should include filter_id in query string', async () => {
      mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } })

      const { result } = renderHook(
        () =>
          useBookmarksQuery({
            view: 'active',
            filter_id: '123',
          }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      const calledUrl = mockGet.mock.calls[0][0] as string
      expect(calledUrl).toContain('filter_id=123')
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
  describe('base keys', () => {
    it('should generate correct all key', () => {
      expect(bookmarkKeys.all).toEqual(['bookmarks'])
    })

    it('should generate correct lists prefix key', () => {
      expect(bookmarkKeys.lists()).toEqual(['bookmarks', 'list'])
    })
  })

  describe('view keys for invalidation', () => {
    it('should generate correct active view key', () => {
      expect(bookmarkKeys.view('active')).toEqual(['bookmarks', 'list', 'active'])
    })

    it('should generate correct archived view key', () => {
      expect(bookmarkKeys.view('archived')).toEqual(['bookmarks', 'list', 'archived'])
    })

    it('should generate correct deleted view key', () => {
      expect(bookmarkKeys.view('deleted')).toEqual(['bookmarks', 'list', 'deleted'])
    })

    it('should generate correct custom lists key', () => {
      expect(bookmarkKeys.customLists()).toEqual(['bookmarks', 'list', 'custom'])
    })
  })

  describe('list query keys', () => {
    it('should include view segment before params for active view', () => {
      const params = { view: 'active' as const, q: 'test' }
      const key = bookmarkKeys.list(params)

      // Key should be ['bookmarks', 'list', 'active', params]
      expect(key[0]).toBe('bookmarks')
      expect(key[1]).toBe('list')
      expect(key[2]).toBe('active')
      expect(key[3]).toEqual(params)
    })

    it('should include view segment before params for archived view', () => {
      const params = { view: 'archived' as const }
      const key = bookmarkKeys.list(params)

      expect(key).toEqual(['bookmarks', 'list', 'archived', params])
    })

    it('should include view segment before params for deleted view', () => {
      const params = { view: 'deleted' as const }
      const key = bookmarkKeys.list(params)

      expect(key).toEqual(['bookmarks', 'list', 'deleted', params])
    })

    it('should default to active view when view is undefined', () => {
      const params = { q: 'test' }
      const key = bookmarkKeys.list(params)

      expect(key[2]).toBe('active')
    })

    it('should use custom segment for queries with filter_id', () => {
      const params = { view: 'active' as const, filter_id: '123' }
      const key = bookmarkKeys.list(params)

      // Custom lists use 'custom' segment instead of view
      expect(key).toEqual(['bookmarks', 'list', 'custom', params])
    })
  })

  describe('prefix matching for invalidation', () => {
    it('view key should be prefix of list key for same view', () => {
      const viewKey = bookmarkKeys.view('active')
      const listKey = bookmarkKeys.list({ view: 'active', q: 'test' })

      // viewKey should be a prefix of listKey
      expect(listKey.slice(0, viewKey.length)).toEqual(viewKey)
    })

    it('customLists key should be prefix of list key with filter_id', () => {
      const customKey = bookmarkKeys.customLists()
      const listKey = bookmarkKeys.list({ view: 'active', filter_id: '123' })

      // customKey should be a prefix of listKey
      expect(listKey.slice(0, customKey.length)).toEqual(customKey)
    })

    it('active view key should NOT match archived list key', () => {
      const activeViewKey = bookmarkKeys.view('active')
      const archivedListKey = bookmarkKeys.list({ view: 'archived' })

      // These should be different at position 2
      expect(activeViewKey[2]).not.toBe(archivedListKey[2])
    })
  })

  describe('multi-value view keys', () => {
    it('should produce stable sorted key for array view', () => {
      const key1 = bookmarkKeys.view(['active', 'archived'])
      const key2 = bookmarkKeys.view(['archived', 'active'])

      expect(key1).toEqual(['bookmarks', 'list', 'active+archived'])
      expect(key2).toEqual(['bookmarks', 'list', 'active+archived'])
    })

    it('should include sorted view segment in list key for array view', () => {
      const params = { view: ['archived', 'active'] as const, q: 'test' }
      const key = bookmarkKeys.list(params)

      expect(key[2]).toBe('active+archived')
    })

    it('should produce single-value key for single string view', () => {
      expect(bookmarkKeys.view('active')).toEqual(['bookmarks', 'list', 'active'])
    })

    it('lists() should be prefix of multi-value view list key', () => {
      const listsKey = bookmarkKeys.lists()
      const listKey = bookmarkKeys.list({ view: ['active', 'archived'], q: 'test' })

      expect(listKey.slice(0, listsKey.length)).toEqual(listsKey)
    })
  })
})
