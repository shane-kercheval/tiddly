/**
 * Tests for useRelationshipSuggestions hook.
 *
 * Covers:
 * - Availability gate: does not fetch when available=false
 * - Context gate: does not fetch when item has no title or tags
 * - Fetching: correct request shape, content truncation
 * - Lifecycle: clear, dismiss
 * - Error handling: silent console.error
 * - Cache: reuses when content unchanged
 * - Cache: invalidates on content change
 * - Cache: dismissed candidates stay dismissed on reopen
 * - Race condition: stale request discarded when new request starts
 * - Race condition: clearSuggestions discards in-flight request
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRelationshipSuggestions } from './useRelationshipSuggestions'
import type { RelationshipCandidate } from '../types'

const mockSuggestRelationships = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestRelationships: (...args: unknown[]) => mockSuggestRelationships(...args),
}))

const MOCK_CANDIDATES: RelationshipCandidate[] = [
  { entity_id: 'note-1', entity_type: 'note', title: 'Related Note' },
  { entity_id: 'bookmark-2', entity_type: 'bookmark', title: 'Related Bookmark' },
]

describe('useRelationshipSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Availability gate
  // -------------------------------------------------------------------------

  describe('availability gate', () => {
    it('does not fetch when available is false', () => {
      const { result } = renderHook(() => useRelationshipSuggestions({ available: false }))

      act(() => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: ['tag1'], existingRelationshipIds: [] })
      })

      expect(mockSuggestRelationships).not.toHaveBeenCalled()
    })

    it('fetches when available is true', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: MOCK_CANDIDATES })
      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: [], existingRelationshipIds: [] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(MOCK_CANDIDATES)
      })
    })
  })

  // -------------------------------------------------------------------------
  // Context gate
  // -------------------------------------------------------------------------

  describe('context gate', () => {
    it('does not fetch when item has no title or tags', () => {
      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({
          title: '',
          description: 'Has description but no title or tags',
          content: 'Has content',
          currentTags: [],
          existingRelationshipIds: [],
        })
      })

      expect(mockSuggestRelationships).not.toHaveBeenCalled()
    })

    it('fetches when item has title but no tags', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: [] })
      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Has Title', currentTags: [], existingRelationshipIds: [] })
      })

      expect(mockSuggestRelationships).toHaveBeenCalled()
    })

    it('fetches when item has tags but no title', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: [] })
      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: '', currentTags: ['python'], existingRelationshipIds: [] })
      })

      expect(mockSuggestRelationships).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Fetching
  // -------------------------------------------------------------------------

  describe('fetching', () => {
    it('sends correct request shape', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: [] })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({
          sourceId: 'source-123',
          title: 'My Note',
          url: 'https://example.com',
          description: 'About testing',
          content: 'Test content',
          currentTags: ['python', 'testing'],
          existingRelationshipIds: ['rel-1', 'rel-2'],
        })
      })

      expect(mockSuggestRelationships).toHaveBeenCalledWith({
        source_id: 'source-123',
        title: 'My Note',
        url: 'https://example.com',
        description: 'About testing',
        content_snippet: 'Test content',
        current_tags: ['python', 'testing'],
        existing_relationship_ids: ['rel-1', 'rel-2'],
      })
    })

    it('truncates content to 2000 chars', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: [] })
      const longContent = 'x'.repeat(5000)

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({
          title: 'Test',
          content: longContent,
          currentTags: ['tag'],
          existingRelationshipIds: [],
        })
      })

      expect(mockSuggestRelationships).toHaveBeenCalledWith(
        expect.objectContaining({ content_snippet: 'x'.repeat(2000) }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('clearSuggestions clears suggestions but preserves cache', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: MOCK_CANDIDATES })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))
      const context = { title: 'Test', currentTags: ['tag'], existingRelationshipIds: [] as string[] }

      await act(async () => {
        result.current.fetchSuggestions(context)
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toHaveLength(2)
      })

      act(() => {
        result.current.clearSuggestions()
      })
      expect(result.current.suggestions).toEqual([])

      // Reopen — should use cache
      act(() => {
        result.current.fetchSuggestions(context)
      })
      expect(result.current.suggestions).toEqual(MOCK_CANDIDATES)
      expect(mockSuggestRelationships).toHaveBeenCalledTimes(1)
    })

    it('dismissSuggestion removes a single candidate', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: MOCK_CANDIDATES })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: ['tag'], existingRelationshipIds: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toHaveLength(2)
      })

      act(() => {
        result.current.dismissSuggestion('note-1')
      })

      expect(result.current.suggestions).toEqual([MOCK_CANDIDATES[1]])
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('logs error silently on API failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestRelationships.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: ['tag'], existingRelationshipIds: [] })
      })

      await vi.waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch relationship suggestions:', expect.any(Error))
      expect(result.current.suggestions).toEqual([])
      consoleSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  describe('caching', () => {
    it('reuses cached suggestions when content unchanged', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: MOCK_CANDIDATES })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))
      const context = { title: 'My Note', description: 'About testing', currentTags: ['tag'], existingRelationshipIds: [] as string[] }

      await act(async () => {
        result.current.fetchSuggestions(context)
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toHaveLength(2)
      })

      act(() => { result.current.clearSuggestions() })

      act(() => { result.current.fetchSuggestions(context) })

      expect(result.current.suggestions).toEqual(MOCK_CANDIDATES)
      expect(mockSuggestRelationships).toHaveBeenCalledTimes(1)
    })

    it('fetches fresh when content changes', async () => {
      const candidates2 = [{ entity_id: 'prompt-3', entity_type: 'prompt', title: 'New Match' }]
      mockSuggestRelationships
        .mockResolvedValueOnce({ candidates: MOCK_CANDIDATES })
        .mockResolvedValueOnce({ candidates: candidates2 })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'First', currentTags: ['tag'], existingRelationshipIds: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(MOCK_CANDIDATES)
      })

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Second', currentTags: ['tag'], existingRelationshipIds: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(candidates2)
      })

      expect(mockSuggestRelationships).toHaveBeenCalledTimes(2)
    })

    it('fetches fresh when tags change but title stays the same', async () => {
      const candidates2 = [{ entity_id: 'prompt-3', entity_type: 'prompt', title: 'Tag Match' }]
      mockSuggestRelationships
        .mockResolvedValueOnce({ candidates: MOCK_CANDIDATES })
        .mockResolvedValueOnce({ candidates: candidates2 })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      await act(async () => {
        result.current.fetchSuggestions({ title: 'Same Title', currentTags: ['python'], existingRelationshipIds: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(MOCK_CANDIDATES)
      })

      // Same title, different tags — should invalidate cache
      await act(async () => {
        result.current.fetchSuggestions({ title: 'Same Title', currentTags: ['rust'], existingRelationshipIds: [] })
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual(candidates2)
      })

      expect(mockSuggestRelationships).toHaveBeenCalledTimes(2)
    })

    it('dismissed candidates stay dismissed on cache reuse', async () => {
      mockSuggestRelationships.mockResolvedValue({ candidates: MOCK_CANDIDATES })

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))
      const context = { title: 'Test', currentTags: ['tag'], existingRelationshipIds: [] as string[] }

      await act(async () => {
        result.current.fetchSuggestions(context)
      })
      await vi.waitFor(() => {
        expect(result.current.suggestions).toHaveLength(2)
      })

      act(() => { result.current.dismissSuggestion('note-1') })
      act(() => { result.current.clearSuggestions() })
      act(() => { result.current.fetchSuggestions(context) })

      expect(result.current.suggestions).toEqual([MOCK_CANDIDATES[1]])
      expect(mockSuggestRelationships).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Race conditions
  // -------------------------------------------------------------------------

  describe('race conditions', () => {
    it('discards stale response when a newer request is in flight', async () => {
      let resolveA: (value: { candidates: RelationshipCandidate[] }) => void
      let resolveB: (value: { candidates: RelationshipCandidate[] }) => void

      mockSuggestRelationships
        .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({ title: 'First', currentTags: ['tag'], existingRelationshipIds: [] })
      })

      act(() => {
        result.current.fetchSuggestions({ title: 'Second', currentTags: ['tag'], existingRelationshipIds: [] })
      })

      // B resolves first
      await act(async () => {
        resolveB!({ candidates: [{ entity_id: 'b-1', entity_type: 'note', title: 'From B' }] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestions).toEqual([{ entity_id: 'b-1', entity_type: 'note', title: 'From B' }])
      })

      // A resolves later — should be discarded
      await act(async () => {
        resolveA!({ candidates: MOCK_CANDIDATES })
      })

      expect(result.current.suggestions).toEqual([{ entity_id: 'b-1', entity_type: 'note', title: 'From B' }])
    })

    it('discards in-flight response after clearSuggestions', async () => {
      let resolveRequest: (value: { candidates: RelationshipCandidate[] }) => void
      mockSuggestRelationships.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))

      const { result } = renderHook(() => useRelationshipSuggestions({ available: true }))

      act(() => {
        result.current.fetchSuggestions({ title: 'Test', currentTags: ['tag'], existingRelationshipIds: [] })
      })

      act(() => {
        result.current.clearSuggestions()
      })

      await act(async () => {
        resolveRequest!({ candidates: MOCK_CANDIDATES })
      })

      expect(result.current.suggestions).toEqual([])
    })
  })
})
