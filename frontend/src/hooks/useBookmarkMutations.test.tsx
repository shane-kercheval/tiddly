/**
 * Tests for useBookmarkMutations hooks.
 *
 * Tests both API calls AND cache invalidation behavior.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useCreateBookmark,
  useUpdateBookmark,
  useDeleteBookmark,
  useRestoreBookmark,
  useArchiveBookmark,
  useUnarchiveBookmark,
} from './useBookmarkMutations'
import { bookmarkKeys } from './useBookmarksQuery'
import { contentKeys } from './useContentQuery'
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockFetchTags = vi.fn()
vi.mock('../stores/tagsStore', () => ({
  useTagsStore: (selector: (state: { fetchTags: () => void }) => unknown) => {
    return selector({ fetchTags: mockFetchTags })
  },
}))

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

describe('useCreateBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a bookmark', async () => {
    const queryClient = createTestQueryClient()
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      tags: ['test'],
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync({
        url: 'https://example.com',
        title: 'Example',
        tags: ['test'],
      })
    })

    expect(created).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/', {
      url: 'https://example.com',
      title: 'Example',
      tags: ['test'],
    })
  })

  it('should invalidate active view and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ url: 'https://example.com' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    // Should NOT invalidate archived or deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ url: 'https://example.com' })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })

  it('should throw on error', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockRejectedValueOnce(new Error('Duplicate URL'))

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await expect(
      result.current.mutateAsync({ url: 'https://example.com' })
    ).rejects.toThrow('Duplicate URL')
  })
})

describe('useUpdateBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update a bookmark', async () => {
    const queryClient = createTestQueryClient()
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Updated Title',
      tags: [],
    }
    mockPatch.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useUpdateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    let updated: unknown
    await act(async () => {
      updated = await result.current.mutateAsync({
        id: '1',
        data: { title: 'Updated Title' },
      })
    })

    expect(updated).toEqual(mockBookmark)
    expect(mockPatch).toHaveBeenCalledWith('/bookmarks/1', { title: 'Updated Title' })
  })

  it('should invalidate active, archived, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPatch.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUpdateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', data: { title: 'New' } })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    // Should NOT invalidate deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags when tags are included in update', async () => {
    const queryClient = createTestQueryClient()
    mockPatch.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUpdateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', data: { tags: ['new-tag'] } })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })

  it('should not refresh tags when tags are not included in update', async () => {
    const queryClient = createTestQueryClient()
    mockPatch.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUpdateBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', data: { title: 'New Title' } })
    })

    expect(mockFetchTags).not.toHaveBeenCalled()
  })
})

describe('useDeleteBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should soft delete a bookmark by default', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1' })
    })

    expect(mockDelete).toHaveBeenCalledWith('/bookmarks/1')
  })

  it('should optimistically remove bookmark from cache before API completes', async () => {
    const queryClient = createTestQueryClient()
    // Set up initial cached data
    const initialData = {
      items: [
        { id: '1', url: 'https://example.com', title: 'Test 1' },
        { id: '2', url: 'https://other.com', title: 'Test 2' },
      ],
      total: 2,
    }
    queryClient.setQueryData(bookmarkKeys.list({ view: 'active', offset: 0, limit: 10 }), initialData)

    // Create a promise that we control to delay API response
    let resolveDelete: () => void
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve
    })
    mockDelete.mockReturnValueOnce(deletePromise)

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    // Start the mutation but don't await it yet
    let mutationPromise: Promise<void>
    act(() => {
      mutationPromise = result.current.mutateAsync({ id: '1' })
    })

    // Wait for optimistic update to apply
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // Check cache was optimistically updated BEFORE API completed
    const cachedData = queryClient.getQueryData(bookmarkKeys.list({ view: 'active', offset: 0, limit: 10 })) as { items: { id: string }[]; total: number }
    expect(cachedData.items).toHaveLength(1)
    expect(cachedData.items[0].id).toBe('2')
    expect(cachedData.total).toBe(1)

    // Now complete the API call
    await act(async () => {
      resolveDelete!()
      await mutationPromise
    })
  })

  it('should rollback optimistic update on API error', async () => {
    const queryClient = createTestQueryClient()
    // Set up initial cached data
    const initialData = {
      items: [
        { id: 1, url: 'https://example.com', title: 'Test 1' },
        { id: 2, url: 'https://other.com', title: 'Test 2' },
      ],
      total: 2,
    }
    queryClient.setQueryData(bookmarkKeys.list({ view: 'active', offset: 0, limit: 10 }), initialData)

    // Make API fail
    mockDelete.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    // Attempt the mutation (should fail)
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: '1' })
      } catch {
        // Expected to fail
      }
    })

    // Cache should be rolled back to original state
    const cachedData = queryClient.getQueryData(bookmarkKeys.list({ view: 'active', offset: 0, limit: 10 })) as { items: { id: number }[]; total: number }
    expect(cachedData.items).toHaveLength(2)
    expect(cachedData.items[0].id).toBe(1)
    expect(cachedData.items[1].id).toBe(2)
  })

  it('should not decrement total when item is not in cached page', async () => {
    const queryClient = createTestQueryClient()
    // Set up cached data for page 2 (items 11-20, doesn't contain item 1)
    const page2Data = {
      items: [
        { id: 11, url: 'https://example11.com', title: 'Test 11' },
        { id: 12, url: 'https://example12.com', title: 'Test 12' },
      ],
      total: 20, // Total across all pages
    }
    queryClient.setQueryData(bookmarkKeys.list({ view: 'active', offset: 10, limit: 10 }), page2Data)

    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1' }) // Delete item 1, which isn't in page 2
    })

    // Page 2's total should NOT be decremented since item 1 wasn't in this page
    const cachedData = queryClient.getQueryData(bookmarkKeys.list({ view: 'active', offset: 10, limit: 10 })) as { items: { id: number }[]; total: number }
    expect(cachedData.items).toHaveLength(2) // Items unchanged
    expect(cachedData.total).toBe(20) // Total unchanged (item wasn't in this page)
  })

  it('should invalidate active, deleted, and custom lists on soft delete', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
    // Should NOT invalidate archived
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
  })

  it('should permanently delete a bookmark when permanent=true', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', permanent: true })
    })

    expect(mockDelete).toHaveBeenCalledWith('/bookmarks/1?permanent=true')
  })

  it('should only invalidate deleted view on permanent delete', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', permanent: true })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
    // Should NOT invalidate active, archived, or custom lists
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
  })

  it('should refresh tags on soft delete', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1' })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })

  it('should refresh tags on permanent delete', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', permanent: true })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useRestoreBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should restore a deleted bookmark', async () => {
    const queryClient = createTestQueryClient()
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      deleted_at: null,
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useRestoreBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    let restored: unknown
    await act(async () => {
      restored = await result.current.mutateAsync('1')
    })

    expect(restored).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/restore')
  })

  it('should invalidate active, deleted, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useRestoreBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
    // Should NOT invalidate archived
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useRestoreBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useArchiveBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should archive a bookmark', async () => {
    const queryClient = createTestQueryClient()
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      archived_at: '2025-01-01T00:00:00Z',
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useArchiveBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    let archived: unknown
    await act(async () => {
      archived = await result.current.mutateAsync('1')
    })

    expect(archived).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/archive')
  })

  it('should invalidate active, archived, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useArchiveBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    // Should NOT invalidate deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useArchiveBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useUnarchiveBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should unarchive a bookmark', async () => {
    const queryClient = createTestQueryClient()
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      archived_at: null,
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useUnarchiveBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    let unarchived: unknown
    await act(async () => {
      unarchived = await result.current.mutateAsync('1')
    })

    expect(unarchived).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/unarchive')
  })

  it('should invalidate active, archived, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUnarchiveBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: bookmarkKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    // Should NOT invalidate deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: bookmarkKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUnarchiveBookmark(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})
