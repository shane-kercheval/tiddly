/**
 * Tests for useLinkedNavigation hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useLinkedNavigation } from './useLinkedNavigation'
import type { LinkedItem } from '../utils/relationships'

const mockNavigate = vi.fn()
const mockTrackBookmarkUsage = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('./useBookmarks', () => ({
  useBookmarks: () => ({
    trackBookmarkUsage: mockTrackBookmarkUsage,
  }),
}))

function makeLinkedItem(overrides: Partial<LinkedItem> = {}): LinkedItem {
  return {
    relationshipId: 'rel-1',
    type: 'note',
    id: 'note-1',
    title: 'Test Item',
    url: null,
    deleted: false,
    archived: false,
    description: null,
    ...overrides,
  }
}

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <MemoryRouter>{children}</MemoryRouter>
  }
}

describe('useLinkedNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should navigate to note detail page for note items', () => {
    const { result } = renderHook(() => useLinkedNavigation(), { wrapper: createWrapper() })

    act(() => {
      result.current(makeLinkedItem({ type: 'note', id: 'note-123' }))
    })

    expect(mockNavigate).toHaveBeenCalledWith('/app/notes/note-123')
    expect(mockTrackBookmarkUsage).not.toHaveBeenCalled()
  })

  it('should navigate to prompt detail page for prompt items', () => {
    const { result } = renderHook(() => useLinkedNavigation(), { wrapper: createWrapper() })

    act(() => {
      result.current(makeLinkedItem({ type: 'prompt', id: 'prompt-456' }))
    })

    expect(mockNavigate).toHaveBeenCalledWith('/app/prompts/prompt-456')
    expect(mockTrackBookmarkUsage).not.toHaveBeenCalled()
  })

  it('should open bookmark URL in new tab and track usage', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { result } = renderHook(() => useLinkedNavigation(), { wrapper: createWrapper() })

    act(() => {
      result.current(makeLinkedItem({
        type: 'bookmark',
        id: 'bm-789',
        url: 'https://example.com',
      }))
    })

    expect(windowOpen).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    expect(mockTrackBookmarkUsage).toHaveBeenCalledWith('bm-789')
    expect(mockNavigate).not.toHaveBeenCalled()

    windowOpen.mockRestore()
  })

  it('should not navigate or open tab for bookmark without URL', () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { result } = renderHook(() => useLinkedNavigation(), { wrapper: createWrapper() })

    act(() => {
      result.current(makeLinkedItem({ type: 'bookmark', id: 'bm-no-url', url: null }))
    })

    expect(windowOpen).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockTrackBookmarkUsage).not.toHaveBeenCalled()

    windowOpen.mockRestore()
  })
})
