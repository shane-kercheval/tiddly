/**
 * Tests for usePromptMutations hooks.
 *
 * Tests both API calls AND cache invalidation behavior.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  useRestorePrompt,
  useArchivePrompt,
  useUnarchivePrompt,
} from './usePromptMutations'
import { promptKeys } from './usePromptsQuery'
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

describe('useCreatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a prompt', async () => {
    const queryClient = createTestQueryClient()
    const mockPrompt = {
      id: 1,
      name: 'test-prompt',
      title: 'Test Prompt',
      description: 'A test prompt',
      content: 'Hello {{ name }}',
      arguments: [{ name: 'name', description: null, required: true }],
      tags: ['test'],
      version: 1,
    }
    mockPost.mockResolvedValueOnce({ data: mockPrompt })

    const { result } = renderHook(() => useCreatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync({
        name: 'test-prompt',
        title: 'Test Prompt',
        description: 'A test prompt',
        content: 'Hello {{ name }}',
        arguments: [{ name: 'name', description: null, required: true }],
        tags: ['test'],
      })
    })

    expect(created).toEqual(mockPrompt)
    expect(mockPost).toHaveBeenCalledWith('/prompts/', {
      name: 'test-prompt',
      title: 'Test Prompt',
      description: 'A test prompt',
      content: 'Hello {{ name }}',
      arguments: [{ name: 'name', description: null, required: true }],
      tags: ['test'],
    })
  })

  it('should invalidate active view and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useCreatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ name: 'test-prompt' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    // Should NOT invalidate archived or deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useCreatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ name: 'test-prompt' })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })

  it('should throw on error', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockRejectedValueOnce(new Error('Validation error'))

    const { result } = renderHook(() => useCreatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await expect(
      result.current.mutateAsync({ name: 'test-prompt' })
    ).rejects.toThrow('Validation error')
  })
})

describe('useUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update a prompt', async () => {
    const queryClient = createTestQueryClient()
    const mockPrompt = {
      id: 1,
      name: 'updated-prompt',
      title: 'Updated Title',
      description: null,
      content: '# Updated',
      arguments: [],
      tags: [],
      version: 2,
    }
    mockPatch.mockResolvedValueOnce({ data: mockPrompt })

    const { result } = renderHook(() => useUpdatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    let updated: unknown
    await act(async () => {
      updated = await result.current.mutateAsync({
        id: '1',
        data: { title: 'Updated Title' },
      })
    })

    expect(updated).toEqual(mockPrompt)
    expect(mockPatch).toHaveBeenCalledWith('/prompts/1', { title: 'Updated Title' })
  })

  it('should invalidate active, archived, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPatch.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUpdatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', data: { title: 'New' } })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    // Should NOT invalidate deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPatch.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUpdatePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', data: { title: 'New' } })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useDeletePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should soft delete a prompt by default', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeletePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1' })
    })

    expect(mockDelete).toHaveBeenCalledWith('/prompts/1')
  })

  it('should invalidate active, archived, deleted, and custom lists on soft delete', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeletePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should permanently delete a prompt when permanent=true', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeletePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', permanent: true })
    })

    expect(mockDelete).toHaveBeenCalledWith('/prompts/1?permanent=true')
  })

  it('should only invalidate deleted view on permanent delete', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeletePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', permanent: true })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
    // Should NOT invalidate active, archived, or custom lists
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
  })

  it('should refresh tags on soft delete', async () => {
    const queryClient = createTestQueryClient()
    mockDelete.mockResolvedValueOnce({})

    const { result } = renderHook(() => useDeletePrompt(), {
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

    const { result } = renderHook(() => useDeletePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({ id: '1', permanent: true })
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useRestorePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should restore a deleted prompt', async () => {
    const queryClient = createTestQueryClient()
    const mockPrompt = {
      id: 1,
      name: 'test-prompt',
      deleted_at: null,
      version: 1,
    }
    mockPost.mockResolvedValueOnce({ data: mockPrompt })

    const { result } = renderHook(() => useRestorePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    let restored: unknown
    await act(async () => {
      restored = await result.current.mutateAsync('1')
    })

    expect(restored).toEqual(mockPrompt)
    expect(mockPost).toHaveBeenCalledWith('/prompts/1/restore')
  })

  it('should invalidate active, deleted, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useRestorePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
    // Should NOT invalidate archived
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useRestorePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useArchivePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should archive a prompt', async () => {
    const queryClient = createTestQueryClient()
    const mockPrompt = {
      id: 1,
      name: 'test-prompt',
      archived_at: '2025-01-01T00:00:00Z',
      version: 1,
    }
    mockPost.mockResolvedValueOnce({ data: mockPrompt })

    const { result } = renderHook(() => useArchivePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    let archived: unknown
    await act(async () => {
      archived = await result.current.mutateAsync('1')
    })

    expect(archived).toEqual(mockPrompt)
    expect(mockPost).toHaveBeenCalledWith('/prompts/1/archive')
  })

  it('should invalidate active, archived, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useArchivePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    // Should NOT invalidate deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useArchivePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})

describe('useUnarchivePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should unarchive a prompt', async () => {
    const queryClient = createTestQueryClient()
    const mockPrompt = {
      id: 1,
      name: 'test-prompt',
      archived_at: null,
      version: 1,
    }
    mockPost.mockResolvedValueOnce({ data: mockPrompt })

    const { result } = renderHook(() => useUnarchivePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    let unarchived: unknown
    await act(async () => {
      unarchived = await result.current.mutateAsync('1')
    })

    expect(unarchived).toEqual(mockPrompt)
    expect(mockPost).toHaveBeenCalledWith('/prompts/1/unarchive')
  })

  it('should invalidate active, archived, and custom lists on success', async () => {
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUnarchivePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.view('archived') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: promptKeys.customLists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('active') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: contentKeys.view('archived') })
    // Should NOT invalidate deleted
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: promptKeys.view('deleted') })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: contentKeys.view('deleted') })
  })

  it('should refresh tags on success', async () => {
    const queryClient = createTestQueryClient()
    mockPost.mockResolvedValueOnce({ data: { id: 1 } })

    const { result } = renderHook(() => useUnarchivePrompt(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync('1')
    })

    expect(mockFetchTags).toHaveBeenCalled()
  })
})
