/**
 * Tests for useMetadataSuggestions hook.
 *
 * Covers:
 * - Availability gate: does not call API when available=false
 * - Fields parameter logic: correct fields based on existing title/description
 * - suggestTitle: generates both when description empty, title-only when description exists
 * - suggestDescription: generates both when title empty, description-only when title exists
 * - Loading state lifecycle
 * - Error handling: silent console.error
 * - Race condition: stale response discarded
 * - onUpdate callback receives correct values
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMetadataSuggestions } from './useMetadataSuggestions'

const mockSuggestMetadata = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestMetadata: (...args: unknown[]) => mockSuggestMetadata(...args),
}))

describe('useMetadataSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Availability gate
  // -------------------------------------------------------------------------

  describe('availability gate', () => {
    it('does not call API when available is false', () => {
      const { result } = renderHook(() => useMetadataSuggestions({ available: false }))
      const onUpdate = vi.fn()

      act(() => {
        result.current.suggestTitle(
          { title: '', description: '', content: 'Some content', url: 'https://example.com' },
          onUpdate,
        )
      })

      expect(mockSuggestMetadata).not.toHaveBeenCalled()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('calls API when available is true', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'Suggested', description: null })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestTitle(
          { title: '', description: 'Existing desc', content: 'Content', url: 'https://example.com' },
          onUpdate,
        )
      })

      await vi.waitFor(() => {
        expect(mockSuggestMetadata).toHaveBeenCalled()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Fields parameter logic
  // -------------------------------------------------------------------------

  describe('suggestTitle fields logic', () => {
    it('sends ["title"] when description exists', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'New Title', description: null })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestTitle(
          { title: 'Old', description: 'Has description', content: 'Content' },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ fields: ['title'] }),
      )
    })

    it('sends ["title", "description"] when description is empty', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'New Title', description: 'New Desc' })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestTitle(
          { title: 'Old', description: '', content: 'Content' },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ fields: ['title', 'description'] }),
      )
    })
  })

  describe('suggestDescription fields logic', () => {
    it('sends ["description"] when title exists', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: null, description: 'New Desc' })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestDescription(
          { title: 'Has title', description: 'Old', content: 'Content' },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ fields: ['description'] }),
      )
    })

    it('sends ["title", "description"] when title is empty', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'New Title', description: 'New Desc' })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestDescription(
          { title: '', description: 'Old', content: 'Content' },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ fields: ['title', 'description'] }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Request shape
  // -------------------------------------------------------------------------

  describe('request shape', () => {
    it('sends correct context fields', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'T', description: null })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestTitle(
          { title: 'Current Title', description: 'Current Desc', content: 'Full content', url: 'https://example.com' },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith({
        fields: ['title'],
        url: 'https://example.com',
        title: 'Current Title',
        description: 'Current Desc',
        content_snippet: 'Full content',
      })
    })

    it('truncates content to 2000 chars', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'T', description: null })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestTitle(
          { title: '', description: 'Desc', content: 'x'.repeat(5000) },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ content_snippet: 'x'.repeat(2000) }),
      )
    })

    it('sends null for empty title and description', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'T', description: 'D' })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestTitle(
          { title: '', description: '', content: 'Content' },
          vi.fn(),
        )
      })

      expect(mockSuggestMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ title: null, description: null }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // onUpdate callback
  // -------------------------------------------------------------------------

  describe('onUpdate callback', () => {
    it('calls onUpdate with title and description from response', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'AI Title', description: 'AI Desc' })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestTitle(
          { title: '', description: '', content: 'Content' },
          onUpdate,
        )
      })

      await vi.waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('AI Title', 'AI Desc')
      })
    })

    it('calls onUpdate with null for unrequested fields', async () => {
      mockSuggestMetadata.mockResolvedValue({ title: 'AI Title', description: null })
      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestTitle(
          { title: '', description: 'Existing', content: 'Content' },
          onUpdate,
        )
      })

      await vi.waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('AI Title', null)
      })
    })
  })

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state', () => {
    it('sets isLoading during request', async () => {
      let resolvePromise: (value: { title: string | null; description: string | null }) => void
      mockSuggestMetadata.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve }))

      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))

      act(() => {
        result.current.suggestTitle({ title: '', description: '', content: 'Content' }, vi.fn())
      })

      expect(result.current.isLoading).toBe(true)

      await act(async () => {
        resolvePromise!({ title: 'T', description: null })
      })

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('logs error silently on API failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestMetadata.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestTitle({ title: '', description: '', content: 'Content' }, onUpdate)
      })

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch metadata suggestion:', expect.any(Error))
      expect(onUpdate).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Race conditions
  // -------------------------------------------------------------------------

  describe('race conditions', () => {
    it('discards stale response when a newer request is in flight', async () => {
      let resolveA: (value: { title: string | null; description: string | null }) => void
      let resolveB: (value: { title: string | null; description: string | null }) => void

      mockSuggestMetadata
        .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))

      const { result } = renderHook(() => useMetadataSuggestions({ available: true }))
      const onUpdateA = vi.fn()
      const onUpdateB = vi.fn()

      // Start request A
      act(() => {
        result.current.suggestTitle({ title: '', description: 'Desc', content: 'Content A' }, onUpdateA)
      })

      // Start request B
      act(() => {
        result.current.suggestDescription({ title: 'Title', description: '', content: 'Content B' }, onUpdateB)
      })

      // B resolves first
      await act(async () => {
        resolveB!({ title: null, description: 'Desc B' })
      })

      await vi.waitFor(() => {
        expect(onUpdateB).toHaveBeenCalledWith(null, 'Desc B')
      })

      // A resolves later — should be discarded
      await act(async () => {
        resolveA!({ title: 'Title A', description: null })
      })

      expect(onUpdateA).not.toHaveBeenCalled()
    })
  })
})
