/**
 * Tests for useBookmarkMutations hooks.
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
import { api } from '../services/api'

vi.mock('../services/api', () => ({
  api: {
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: (selector: (state: { fetchTags: () => void }) => unknown) => {
    const fetchTags = vi.fn()
    return selector({ fetchTags })
  },
}))

const mockPost = api.post as Mock
const mockPatch = api.patch as Mock
const mockDelete = api.delete as Mock

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useCreateBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a bookmark', async () => {
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      tags: ['test'],
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(),
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

  it('should throw on error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Duplicate URL'))

    const { result } = renderHook(() => useCreateBookmark(), {
      wrapper: createWrapper(),
    })

    await expect(
      result.current.mutateAsync({
        url: 'https://example.com',
      })
    ).rejects.toThrow('Duplicate URL')
  })
})

describe('useUpdateBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update a bookmark', async () => {
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Updated Title',
      tags: [],
    }
    mockPatch.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useUpdateBookmark(), {
      wrapper: createWrapper(),
    })

    let updated: unknown
    await act(async () => {
      updated = await result.current.mutateAsync({
        id: 1,
        data: { title: 'Updated Title' },
      })
    })

    expect(updated).toEqual(mockBookmark)
    expect(mockPatch).toHaveBeenCalledWith('/bookmarks/1', { title: 'Updated Title' })
  })
})

describe('useDeleteBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should soft delete a bookmark by default', async () => {
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: 1 })
    })

    expect(mockDelete).toHaveBeenCalledWith('/bookmarks/1')
  })

  it('should permanently delete a bookmark when permanent=true', async () => {
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeleteBookmark(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: 1, permanent: true })
    })

    expect(mockDelete).toHaveBeenCalledWith('/bookmarks/1?permanent=true')
  })
})

describe('useRestoreBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should restore a deleted bookmark', async () => {
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      deleted_at: null,
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useRestoreBookmark(), {
      wrapper: createWrapper(),
    })

    let restored: unknown
    await act(async () => {
      restored = await result.current.mutateAsync(1)
    })

    expect(restored).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/restore')
  })
})

describe('useArchiveBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should archive a bookmark', async () => {
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      archived_at: '2025-01-01T00:00:00Z',
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useArchiveBookmark(), {
      wrapper: createWrapper(),
    })

    let archived: unknown
    await act(async () => {
      archived = await result.current.mutateAsync(1)
    })

    expect(archived).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/archive')
  })
})

describe('useUnarchiveBookmark', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should unarchive a bookmark', async () => {
    const mockBookmark = {
      id: 1,
      url: 'https://example.com',
      title: 'Example',
      archived_at: null,
    }
    mockPost.mockResolvedValueOnce({ data: mockBookmark })

    const { result } = renderHook(() => useUnarchiveBookmark(), {
      wrapper: createWrapper(),
    })

    let unarchived: unknown
    await act(async () => {
      unarchived = await result.current.mutateAsync(1)
    })

    expect(unarchived).toEqual(mockBookmark)
    expect(mockPost).toHaveBeenCalledWith('/bookmarks/1/unarchive')
  })
})
