/**
 * Tests for the public read-view fetch hooks.
 *
 * The key guarantee: public reads go through `publicApi` (no auth interceptor),
 * never the authed `api` instance — so a logged-out visitor never triggers a
 * token fetch / login_required.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { usePublicBookmark, usePublicNote, usePublicPrompt } from './usePublicItem'
import { api, publicApi } from '../services/api'

vi.mock('../services/api', () => ({
  publicApi: { get: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
  GLOBALLY_TOASTED_STATUSES: [402, 429],
}))

const mockPublicGet = publicApi.get as Mock
const mockApiGet = api.get as Mock

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  // retryDelay 0 so the transient-retry test doesn't wait on backoff. The hook
  // sets its own per-query `retry` function (overriding the `retry: false` here).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('usePublicItem hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('usePublicNote fetches /public/notes/{token} via publicApi (not the authed client)', async () => {
    mockPublicGet.mockResolvedValueOnce({ data: { title: 'Shared', content: 'body', is_archived: false } })

    const { result } = renderHook(() => usePublicNote('tok-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockPublicGet).toHaveBeenCalledWith('/public/notes/tok-1')
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it('usePublicBookmark fetches /public/bookmarks/{token}', async () => {
    mockPublicGet.mockResolvedValueOnce({ data: { url: 'https://x.com', is_archived: false } })

    const { result } = renderHook(() => usePublicBookmark('tok-2'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockPublicGet).toHaveBeenCalledWith('/public/bookmarks/tok-2')
  })

  it('usePublicPrompt fetches /public/prompts/{token}', async () => {
    mockPublicGet.mockResolvedValueOnce({ data: { name: 'p', arguments: [], is_archived: false } })

    const { result } = renderHook(() => usePublicPrompt('tok-3'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockPublicGet).toHaveBeenCalledWith('/public/prompts/tok-3')
  })

  it('does not retry a 404 (deterministic not-found)', async () => {
    mockPublicGet.mockRejectedValue({ isAxiosError: true, response: { status: 404 } })

    const { result } = renderHook(() => usePublicNote('missing'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockPublicGet).toHaveBeenCalledTimes(1)
  })

  it('retries a transient (non-404) failure before surfacing the error', async () => {
    mockPublicGet.mockRejectedValue({ isAxiosError: true, response: { status: 500 } })

    const { result } = renderHook(() => usePublicNote('flaky'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockPublicGet.mock.calls.length).toBeGreaterThan(1)
  })

  it('does not fetch when the token is undefined', () => {
    renderHook(() => usePublicNote(undefined), { wrapper: createWrapper() })
    expect(mockPublicGet).not.toHaveBeenCalled()
  })
})
