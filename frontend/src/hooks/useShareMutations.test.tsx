/**
 * Tests for the generic share mutations (publish / unpublish / rotate).
 *
 * Each mutation hits the type-scoped endpoint, returns the updated detail item,
 * and invalidates the type-specific list keys + the unified content keys so the
 * "shared" indicator (when present) refreshes. History keys are deliberately not
 * invalidated — sharing is not a content event.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useShareMutations, applyShareFields } from './useShareMutations'
import { api } from '../services/api'

vi.mock('../services/api', () => ({ api: { post: vi.fn(), delete: vi.fn() } }))

const mockPost = api.post as Mock
const mockDelete = api.delete as Mock

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useShareMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  it('publish POSTs to /{type}/{id}/share, returns the item, invalidates list + content', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'b1', is_public: true, public_token: 'tok' } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useShareMutations('bookmarks'), { wrapper })
    let returned: unknown
    await act(async () => { returned = await result.current.publish.mutateAsync('b1') })

    expect(mockPost).toHaveBeenCalledWith('/bookmarks/b1/share')
    expect(returned).toEqual({ id: 'b1', is_public: true, public_token: 'tok' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bookmarks', 'list'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['content', 'list'] })
  })

  it('unpublish DELETEs /{type}/{id}/share', async () => {
    mockDelete.mockResolvedValueOnce({ data: { id: 'n1', is_public: false, public_token: 'tok' } })

    const { result } = renderHook(() => useShareMutations('notes'), { wrapper })
    await act(async () => { await result.current.unpublish.mutateAsync('n1') })

    expect(mockDelete).toHaveBeenCalledWith('/notes/n1/share')
  })

  it('rotate POSTs to /{type}/{id}/rotate-share-token', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'p1', is_public: true, public_token: 'new' } })

    const { result } = renderHook(() => useShareMutations('prompts'), { wrapper })
    await act(async () => { await result.current.rotate.mutateAsync('p1') })

    expect(mockPost).toHaveBeenCalledWith('/prompts/p1/rotate-share-token')
  })

  it('invalidates the type-specific list key (notes → notes/list, not bookmarks)', async () => {
    mockDelete.mockResolvedValueOnce({ data: {} })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useShareMutations('notes'), { wrapper })
    await act(async () => { await result.current.unpublish.mutateAsync('n1') })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes', 'list'] })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['bookmarks', 'list'] })
  })
})

describe('applyShareFields', () => {
  it('merges only the share fields, preserving content/content_metadata and ignoring other response fields', () => {
    const prev = {
      id: 'b1',
      content: 'loaded body',
      content_metadata: { total_lines: 3 },
      title: 'Original',
      is_public: false,
      public_token: null,
    }
    // The share response carries extra fields (full content, no content_metadata);
    // applyShareFields must take ONLY is_public/public_token from it.
    const shareResponse = { is_public: true, public_token: 'tok', content: 'SHOULD_NOT_LEAK' } as unknown as {
      is_public: boolean
      public_token: string | null
    }

    const merged = applyShareFields(prev, shareResponse)

    expect(merged).toEqual({
      id: 'b1',
      content: 'loaded body',
      content_metadata: { total_lines: 3 },
      title: 'Original',
      is_public: true,
      public_token: 'tok',
    })
  })
})
