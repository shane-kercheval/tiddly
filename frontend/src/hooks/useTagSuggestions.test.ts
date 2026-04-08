/**
 * Tests for useTagSuggestions hook.
 *
 * Covers:
 * - Availability gate: does not fetch when available=false
 * - Context gate: does not fetch when item is blank
 * - Fetching: correct request shape, content truncation
 * - Lifecycle: clear, dismiss
 * - Error handling: silent console.error
 * - Cache: reuses when content unchanged
 * - Cache: invalidates on content change
 * - Cache: dismissed tags stay dismissed on reopen
 * - Cache: currentTags changes don't invalidate
 * - Race condition: stale request A discarded when request B starts
 * - Race condition: clearSuggestions discards in-flight request
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTagSuggestions } from './useTagSuggestions'

const mockSuggestTags = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestTags: (...args: unknown[]) => mockSuggestTags(...args),
}))

describe('useTagSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Availability gate
  // -------------------------------------------------------------------------

  describe('availability gate', () => {
    it('does not fetch when available is false', () => {
      const { result } = renderHook(() => useTagSuggestions({ available: false }))

      act(() => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })

      expect(mockSuggestTags).not.toHaveBeenCalled()
      expect(result.current.isLoading).toBe(false)
      expect(result.current.suggestions).toEqual([])
    })

    it('does not fetch when available is false even with valid context', () => {
      const { result } = renderHook(() => useTagSuggestions({ available: false }))

      act(() => {
        result.current.fetchSuggestions({
          title: 'Great Article',
          url: 'https://example.com',
          description: 'About testing',
          content: 'Lots of content here',
          currentTags: ['existing'],
        })
      })

      expect(mockSuggestTags).not.toHaveBeenCalled()
    })

    it('fetches when available is true', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript'] })
      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['javascript'])
      })
    })

    it('defaults available to true when not provided', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript'] })
      const { result } = renderHook(() => useTagSuggestions())

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })

      expect(mockSuggestTags).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Context gate
  // -------------------------------------------------------------------------

  describe('context gate', () => {
    it('does not fetch when item has no context (empty strings)', () => {
      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({
          title: '',
          url: '',
          description: '',
          content: '',
          currentTags: [],
        })
      })

      expect(mockSuggestTags).not.toHaveBeenCalled()
    })

    it('does not fetch when item has only null/undefined context', () => {
      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({
          title: null,
          url: null,
          description: null,
          content: null,
          currentTags: [],
        })
      })

      expect(mockSuggestTags).not.toHaveBeenCalled()
    })

    it('does not fetch when context is only whitespace', () => {
      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({
          title: '   ',
          description: '  ',
          currentTags: [],
        })
      })

      expect(mockSuggestTags).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Fetching
  // -------------------------------------------------------------------------

  describe('fetching', () => {
    it('sends correct request shape', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['react'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({
          title: 'My Article',
          url: 'https://example.com',
          description: 'About React',
          content: 'React is a library',
          currentTags: ['existing'],
        })
      })

      expect(mockSuggestTags).toHaveBeenCalledWith({
        title: 'My Article',
        url: 'https://example.com',
        description: 'About React',
        content_snippet: 'React is a library',
        current_tags: ['existing'],
      })
    })

    it('truncates content to 2000 chars', async () => {
      mockSuggestTags.mockResolvedValue({ tags: [] })
      const longContent = 'x'.repeat(5000)

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({
          title: 'Test',
          content: longContent,
          currentTags: [],
        })
      })

      expect(mockSuggestTags).toHaveBeenCalledWith(
        expect.objectContaining({ content_snippet: 'x'.repeat(2000) }),
      )
    })

    it('sets isLoading during fetch', async () => {
      let resolvePromise: (value: { tags: string[] }) => void
      mockSuggestTags.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve }))

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })

      expect(result.current.isLoading).toBe(true)

      await act(async () => {
        resolvePromise!({ tags: ['test'] })
      })

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('clearSuggestions clears suggestions but preserves cache', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['javascript'])
      })

      act(() => {
        result.current.clearSuggestions()
      })

      expect(result.current.suggestions).toEqual([])

      // Cache still works — same content returns cached result
      act(() => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })
      expect(result.current.suggestions).toEqual(['javascript'])
      expect(mockSuggestTags).toHaveBeenCalledTimes(1) // no new call
    })

    it('dismissSuggestion removes a single tag', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript', 'react', 'typescript'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toHaveLength(3)
      })

      act(() => {
        result.current.dismissSuggestion('react')
      })

      expect(result.current.suggestions).toEqual(['javascript', 'typescript'])
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('logs error silently on API failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestTags.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch tag suggestions:', expect.any(Error))
      expect(result.current.suggestions).toEqual([])
      consoleSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  describe('caching', () => {
    it('reuses cached suggestions when content unchanged', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript', 'react'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      const context = { title: 'My Article', description: 'About JS', currentTags: [] as string[] }

      // First fetch
      await act(async () => {
        result.current.fetchSuggestions(context)
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['javascript', 'react'])
      })
      expect(mockSuggestTags).toHaveBeenCalledTimes(1)

      // Clear (simulates closing tag input)
      act(() => {
        result.current.clearSuggestions()
      })

      // Second fetch with same content — should use cache
      act(() => {
        result.current.fetchSuggestions(context)
      })

      expect(result.current.suggestions).toEqual(['javascript', 'react'])
      expect(mockSuggestTags).toHaveBeenCalledTimes(1) // no new API call
    })

    it('fetches fresh when content changes', async () => {
      mockSuggestTags
        .mockResolvedValueOnce({ tags: ['javascript'] })
        .mockResolvedValueOnce({ tags: ['python'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      // First fetch
      await act(async () => {
        result.current.fetchSuggestions({ title: 'JS Article', currentTags: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['javascript'])
      })

      // Second fetch with different content
      await act(async () => {
        result.current.fetchSuggestions({ title: 'Python Article', currentTags: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['python'])
      })

      expect(mockSuggestTags).toHaveBeenCalledTimes(2)
    })

    it('dismissed tags stay dismissed on cache reuse', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript', 'react', 'typescript'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      const context = { title: 'My Article', currentTags: [] as string[] }

      await act(async () => {
        result.current.fetchSuggestions(context)
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toHaveLength(3)
      })

      // Dismiss 'react'
      act(() => {
        result.current.dismissSuggestion('react')
      })

      // Clear and reopen
      act(() => {
        result.current.clearSuggestions()
      })
      act(() => {
        result.current.fetchSuggestions(context)
      })

      expect(result.current.suggestions).toEqual(['javascript', 'typescript'])
      expect(mockSuggestTags).toHaveBeenCalledTimes(1) // still cached
    })

    it('currentTags changes do not invalidate cache', async () => {
      mockSuggestTags.mockResolvedValue({ tags: ['javascript', 'react'] })

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'My Article', currentTags: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['javascript', 'react'])
      })

      act(() => {
        result.current.dismissSuggestion('react')
      })

      // Reopen with 'react' now in currentTags
      act(() => {
        result.current.clearSuggestions()
      })
      act(() => {
        result.current.fetchSuggestions({ title: 'My Article', currentTags: ['react'] })
      })

      expect(result.current.suggestions).toEqual(['javascript'])
      expect(mockSuggestTags).toHaveBeenCalledTimes(1) // cache hit
    })
  })

  // -------------------------------------------------------------------------
  // Race conditions
  // -------------------------------------------------------------------------

  describe('race conditions', () => {
    it('discards stale response when a newer request is in flight', async () => {
      // Request A resolves slowly with ['javascript']
      // Request B resolves quickly with ['python']
      // Result should be ['python'], not ['javascript']
      let resolveA: (value: { tags: string[] }) => void
      let resolveB: (value: { tags: string[] }) => void

      mockSuggestTags
        .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      // Start request A
      act(() => {
        result.current.fetchSuggestions({ title: 'JS Article', currentTags: [] })
      })
      expect(mockSuggestTags).toHaveBeenCalledTimes(1)

      // Start request B (different content, so no cache hit)
      act(() => {
        result.current.fetchSuggestions({ title: 'Python Article', currentTags: [] })
      })
      expect(mockSuggestTags).toHaveBeenCalledTimes(2)

      // B resolves first
      await act(async () => {
        resolveB!({ tags: ['python'] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(['python'])
      })

      // A resolves later — should be discarded
      await act(async () => {
        resolveA!({ tags: ['javascript'] })
      })

      // Suggestions should still be ['python'], not overwritten by stale A
      expect(result.current.suggestions).toEqual(['python'])
    })

    it('discards in-flight response after clearSuggestions', async () => {
      let resolveRequest: (value: { tags: string[] }) => void
      mockSuggestTags.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))

      const { result } = renderHook(() => useTagSuggestions({ available: true }))

      // Start request
      act(() => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [] })
      })
      expect(result.current.isLoading).toBe(true)

      // Clear before response arrives
      act(() => {
        result.current.clearSuggestions()
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.suggestions).toEqual([])

      // Response arrives after clear — should be discarded
      await act(async () => {
        resolveRequest!({ tags: ['stale-tag'] })
      })

      expect(result.current.suggestions).toEqual([])
      expect(result.current.isLoading).toBe(false)
    })
  })
})
