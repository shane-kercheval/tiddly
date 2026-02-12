/**
 * Tests for useRelationships hooks and query key factory.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { ReactNode } from 'react'
import {
  useContentRelationships,
  useRelationshipMutations,
  relationshipKeys,
} from './useRelationships'
import { api } from '../services/api'

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}))

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = api.get as Mock
const mockPost = api.post as Mock
const mockPatch = api.patch as Mock
const mockDelete = api.delete as Mock

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('relationshipKeys', () => {
  it('should generate correct all key', () => {
    expect(relationshipKeys.all).toEqual(['relationships'])
  })

  it('should generate correct forContent key', () => {
    expect(relationshipKeys.forContent('bookmark', '123')).toEqual([
      'relationships', 'content', 'bookmark', '123',
    ])
  })

  it('should generate correct forContent key for note', () => {
    expect(relationshipKeys.forContent('note', 'abc')).toEqual([
      'relationships', 'content', 'note', 'abc',
    ])
  })

  it('forContent key should be a prefix of query key with options', () => {
    const baseKey = relationshipKeys.forContent('bookmark', '123')
    const queryKey = [...baseKey, { includeContentInfo: true }]
    expect(queryKey.slice(0, baseKey.length)).toEqual(baseKey)
  })
})

describe('useContentRelationships', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch relationships for a content item', async () => {
    const queryClient = createTestQueryClient()
    const mockData = {
      items: [{
        id: 'rel-1',
        source_type: 'bookmark',
        source_id: 'bm-1',
        target_type: 'note',
        target_id: 'note-1',
        relationship_type: 'related',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        source_title: 'My Bookmark',
        source_url: 'https://example.com',
        target_title: 'My Note',
        target_url: null,
        source_deleted: false,
        target_deleted: false,
        source_archived: false,
        target_archived: false,
      }],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
    }
    mockGet.mockResolvedValueOnce({ data: mockData })

    const { result } = renderHook(
      () => useContentRelationships('bookmark', 'bm-1'),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual(mockData)
    expect(mockGet).toHaveBeenCalledWith(
      '/relationships/content/bookmark/bm-1',
      { params: { include_content_info: true } },
    )
  })

  it('should pass include_content_info param', async () => {
    const queryClient = createTestQueryClient()
    mockGet.mockResolvedValueOnce({ data: { items: [], total: 0, offset: 0, limit: 50, has_more: false } })

    const { result } = renderHook(
      () => useContentRelationships('note', 'note-1', { includeContentInfo: false }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockGet).toHaveBeenCalledWith(
      '/relationships/content/note/note-1',
      { params: { include_content_info: false } },
    )
  })

  it('should not fetch when contentType is null', () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(
      () => useContentRelationships(null, 'some-id'),
      { wrapper: createWrapper(queryClient) },
    )

    expect(result.current.isPending).toBe(true)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('should not fetch when contentId is null', () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(
      () => useContentRelationships('bookmark', null),
      { wrapper: createWrapper(queryClient) },
    )

    expect(result.current.isPending).toBe(true)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('should produce stable cache key whether options omitted or default', async () => {
    const queryClient = createTestQueryClient()
    const emptyResponse = { data: { items: [], total: 0, offset: 0, limit: 50, has_more: false } }
    mockGet.mockResolvedValue(emptyResponse)

    // Call without options
    const { result: r1 } = renderHook(
      () => useContentRelationships('bookmark', 'bm-1'),
      { wrapper: createWrapper(queryClient) },
    )
    await waitFor(() => expect(r1.current.isSuccess).toBe(true))

    // Call with explicit default
    const { result: r2 } = renderHook(
      () => useContentRelationships('bookmark', 'bm-1', { includeContentInfo: true }),
      { wrapper: createWrapper(queryClient) },
    )
    await waitFor(() => expect(r2.current.isSuccess).toBe(true))

    // Both should have hit the API only once (shared cache)
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('should handle errors', async () => {
    const queryClient = createTestQueryClient()
    mockGet.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(
      () => useContentRelationships('bookmark', 'bm-1'),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe('useRelationshipMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('should create a relationship and invalidate cache', async () => {
      const queryClient = createTestQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const mockRel = {
        id: 'rel-1',
        source_type: 'bookmark',
        source_id: 'bm-1',
        target_type: 'note',
        target_id: 'note-1',
        relationship_type: 'related',
        description: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      mockPost.mockResolvedValueOnce({ data: mockRel })

      const { result } = renderHook(
        () => useRelationshipMutations(),
        { wrapper: createWrapper(queryClient) },
      )

      await act(async () => {
        await result.current.create.mutateAsync({
          source_type: 'bookmark',
          source_id: 'bm-1',
          target_type: 'note',
          target_id: 'note-1',
          relationship_type: 'related',
        })
      })

      expect(mockPost).toHaveBeenCalledWith('/relationships/', {
        source_type: 'bookmark',
        source_id: 'bm-1',
        target_type: 'note',
        target_id: 'note-1',
        relationship_type: 'related',
      })

      // Should invalidate both source and target content queries
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: relationshipKeys.forContent('bookmark', 'bm-1'),
      })
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: relationshipKeys.forContent('note', 'note-1'),
      })
    })
  })

  describe('update', () => {
    it('should update a relationship and invalidate cache', async () => {
      const queryClient = createTestQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const mockRel = {
        id: 'rel-1',
        description: 'Updated description',
      }
      mockPatch.mockResolvedValueOnce({ data: mockRel })

      const { result } = renderHook(
        () => useRelationshipMutations(),
        { wrapper: createWrapper(queryClient) },
      )

      await act(async () => {
        await result.current.update.mutateAsync({
          id: 'rel-1',
          data: { description: 'Updated description' },
        })
      })

      expect(mockPatch).toHaveBeenCalledWith('/relationships/rel-1', {
        description: 'Updated description',
      })

      // Should invalidate all relationship queries
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: relationshipKeys.all,
      })
    })
  })

  describe('remove', () => {
    it('should delete a relationship and invalidate cache', async () => {
      const queryClient = createTestQueryClient()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      mockDelete.mockResolvedValueOnce({})

      const { result } = renderHook(
        () => useRelationshipMutations(),
        { wrapper: createWrapper(queryClient) },
      )

      await act(async () => {
        await result.current.remove.mutateAsync('rel-1')
      })

      expect(mockDelete).toHaveBeenCalledWith('/relationships/rel-1')

      // Should invalidate all relationship queries
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: relationshipKeys.all,
      })
    })

    it('should show error toast when remove fails', async () => {
      const queryClient = createTestQueryClient()
      mockDelete.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(
        () => useRelationshipMutations(),
        { wrapper: createWrapper(queryClient) },
      )

      await act(async () => {
        result.current.remove.mutate('rel-1')
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to remove link')
      })
    })
  })
})
