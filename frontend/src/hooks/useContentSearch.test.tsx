/**
 * Tests for useContentSearch hook.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useContentSearch } from './useContentSearch'
import { api } from '../services/api'
import type { ContentListItem, ContentListResponse } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
  },
}))

const mockGet = api.get as Mock

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeContentItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    type: 'note',
    id: 'note-2',
    title: 'Search Result',
    description: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    archived_at: null,
    content_preview: null,
    url: null,
    version: 1,
    name: null,
    arguments: null,
    ...overrides,
  }
}

function makeSearchResponse(items: ContentListItem[]): ContentListResponse {
  return { items, total: items.length, offset: 0, limit: 20, has_more: false }
}

describe('useContentSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize with empty state', () => {
    mockGet.mockResolvedValue({ data: makeSearchResponse([]) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    expect(result.current.inputValue).toBe('')
    expect(result.current.showDropdown).toBe(false)
    expect(result.current.highlightedIndex).toBe(-1)
    expect(result.current.results).toEqual([])
  })

  it('should update inputValue and show dropdown when typing', () => {
    mockGet.mockResolvedValue({ data: makeSearchResponse([]) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })

    expect(result.current.inputValue).toBe('test')
    expect(result.current.showDropdown).toBe(true)
  })

  it('should filter out source item from results', async () => {
    const items = [
      makeContentItem({ type: 'note', id: 'note-1', title: 'Self' }),
      makeContentItem({ type: 'note', id: 'note-2', title: 'Other' }),
    ]
    mockGet.mockResolvedValue({ data: makeSearchResponse(items) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })

    // Advance debounce timer
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Wait for query to resolve
    await vi.waitFor(() => {
      expect(result.current.results).toHaveLength(1)
    })
    expect(result.current.results[0].id).toBe('note-2')
  })

  it('should filter out already-linked items from results', async () => {
    const items = [
      makeContentItem({ type: 'bookmark', id: 'bm-1', title: 'Already Linked' }),
      makeContentItem({ type: 'note', id: 'note-2', title: 'Not Linked' }),
    ]
    mockGet.mockResolvedValue({ data: makeSearchResponse(items) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(['bookmark:bm-1']),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    await vi.waitFor(() => {
      expect(result.current.results).toHaveLength(1)
    })
    expect(result.current.results[0].title).toBe('Not Linked')
  })

  it('should manage keyboard highlight navigation', async () => {
    const items = [
      makeContentItem({ id: 'note-2', title: 'A' }),
      makeContentItem({ id: 'note-3', title: 'B' }),
      makeContentItem({ id: 'note-4', title: 'C' }),
    ]
    mockGet.mockResolvedValue({ data: makeSearchResponse(items) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    await vi.waitFor(() => {
      expect(result.current.results).toHaveLength(3)
    })

    // Move down
    act(() => { result.current.moveHighlight('down') })
    expect(result.current.highlightedIndex).toBe(0)

    act(() => { result.current.moveHighlight('down') })
    expect(result.current.highlightedIndex).toBe(1)

    // Move up
    act(() => { result.current.moveHighlight('up') })
    expect(result.current.highlightedIndex).toBe(0)

    // Don't go below 0
    act(() => { result.current.moveHighlight('up') })
    expect(result.current.highlightedIndex).toBe(0)
  })

  it('should select highlighted item', async () => {
    const items = [
      makeContentItem({ id: 'note-2', title: 'Result A' }),
      makeContentItem({ id: 'note-3', title: 'Result B' }),
    ]
    mockGet.mockResolvedValue({ data: makeSearchResponse(items) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    await vi.waitFor(() => {
      expect(result.current.results).toHaveLength(2)
    })

    // Highlight first item and select
    act(() => { result.current.moveHighlight('down') })
    let selected: ReturnType<typeof result.current.selectHighlighted>
    act(() => { selected = result.current.selectHighlighted() })

    expect(selected!).toEqual(expect.objectContaining({ id: 'note-2', title: 'Result A' }))
    // Should reset input after selection
    expect(result.current.inputValue).toBe('')
    expect(result.current.showDropdown).toBe(false)
  })

  it('should return null when selectHighlighted with no highlight', () => {
    mockGet.mockResolvedValue({ data: makeSearchResponse([]) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    let selected: ReturnType<typeof result.current.selectHighlighted>
    act(() => { selected = result.current.selectHighlighted() })
    expect(selected!).toBeNull()
  })

  it('should reset all state', async () => {
    mockGet.mockResolvedValue({ data: makeSearchResponse([makeContentItem()]) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })

    expect(result.current.inputValue).toBe('test')
    expect(result.current.showDropdown).toBe(true)

    act(() => {
      result.current.reset()
    })

    expect(result.current.inputValue).toBe('')
    expect(result.current.showDropdown).toBe(false)
    expect(result.current.highlightedIndex).toBe(-1)
  })

  it('should hide dropdown when input cleared', () => {
    mockGet.mockResolvedValue({ data: makeSearchResponse([]) })

    const { result } = renderHook(
      () => useContentSearch({
        sourceKey: 'note:note-1',
        excludeKeys: new Set(),
        enabled: true,
      }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setInputValue('test')
    })
    expect(result.current.showDropdown).toBe(true)

    act(() => {
      result.current.setInputValue('')
    })
    expect(result.current.showDropdown).toBe(false)
  })
})
