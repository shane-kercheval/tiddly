/**
 * Tests for useQuickCreateLinked hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useQuickCreateLinked } from './useQuickCreateLinked'

const mockNavigate = vi.fn()
const mockLocation = { pathname: '/app/notes/note-123', search: '', state: null, hash: '', key: '' }

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}))

describe('useQuickCreateLinked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return undefined when contentId is null', () => {
    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'note',
        contentId: null,
        contentTitle: 'My Note',
      }),
    )

    expect(result.current).toBeUndefined()
  })

  it('should return a function when contentId is provided', () => {
    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'note',
        contentId: 'note-123',
        contentTitle: 'My Note',
      }),
    )

    expect(typeof result.current).toBe('function')
  })

  it('should navigate to bookmark new page with correct state', () => {
    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'note',
        contentId: 'note-123',
        contentTitle: 'My Note',
      }),
    )

    act(() => {
      result.current!('bookmark')
    })

    expect(mockNavigate).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith('/app/bookmarks/new', {
      state: {
        returnTo: '/app/notes/note-123',
        initialRelationships: [{
          target_type: 'note',
          target_id: 'note-123',
          relationship_type: 'related',
        }],
        initialLinkedItems: [{
          relationshipId: '',
          type: 'note',
          id: 'note-123',
          title: 'My Note',
          url: null,
          promptName: null,
          deleted: false,
          archived: false,
          description: null,
        }],
      },
    })
  })

  it('should navigate to note new page when targeting note', () => {
    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'bookmark',
        contentId: 'bm-1',
        contentTitle: 'My BM',
        contentUrl: 'https://example.com',
      }),
    )

    act(() => {
      result.current!('note')
    })

    expect(mockNavigate).toHaveBeenCalledWith('/app/notes/new', expect.objectContaining({
      state: expect.objectContaining({
        initialRelationships: [{
          target_type: 'bookmark',
          target_id: 'bm-1',
          relationship_type: 'related',
        }],
        initialLinkedItems: [expect.objectContaining({
          type: 'bookmark',
          id: 'bm-1',
          title: 'My BM',
          url: 'https://example.com',
        })],
      }),
    }))
  })

  it('should navigate to prompt new page when targeting prompt', () => {
    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'note',
        contentId: 'note-1',
        contentTitle: 'Source Note',
      }),
    )

    act(() => {
      result.current!('prompt')
    })

    expect(mockNavigate).toHaveBeenCalledWith('/app/prompts/new', expect.objectContaining({
      state: expect.objectContaining({
        returnTo: '/app/notes/note-123',
      }),
    }))
  })

  it('should include promptName in seeded items for prompt sources', () => {
    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'prompt',
        contentId: 'prompt-1',
        contentTitle: null,
        contentPromptName: 'my-prompt',
      }),
    )

    act(() => {
      result.current!('note')
    })

    expect(mockNavigate).toHaveBeenCalledWith('/app/notes/new', expect.objectContaining({
      state: expect.objectContaining({
        initialLinkedItems: [expect.objectContaining({
          type: 'prompt',
          id: 'prompt-1',
          title: null,
          promptName: 'my-prompt',
        })],
      }),
    }))
  })

  it('should include search params in returnTo', () => {
    mockLocation.search = '?tab=edit'

    const { result } = renderHook(() =>
      useQuickCreateLinked({
        contentType: 'note',
        contentId: 'note-1',
        contentTitle: 'Test',
      }),
    )

    act(() => {
      result.current!('bookmark')
    })

    expect(mockNavigate).toHaveBeenCalledWith('/app/bookmarks/new', expect.objectContaining({
      state: expect.objectContaining({
        returnTo: '/app/notes/note-123?tab=edit',
      }),
    }))

    mockLocation.search = ''
  })
})
