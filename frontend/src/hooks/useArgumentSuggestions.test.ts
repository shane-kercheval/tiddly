/**
 * Tests for useArgumentSuggestions hook.
 *
 * Covers:
 * - Availability gate: does not call API when available=false
 * - suggestAll: sends correct request, appends results via onUpdate
 * - suggestName: sends target, updates name via onUpdate
 * - suggestDescription: sends target, updates description via onUpdate
 * - Loading state lifecycle for generate-all and individual suggestions
 * - Error handling: silent console.error
 * - Race condition: stale response discarded
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArgumentSuggestions } from './useArgumentSuggestions'
import type { PromptArgument } from '../types'

const mockSuggestArguments = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestArguments: (...args: unknown[]) => mockSuggestArguments(...args),
}))

const makeArgs = (...names: string[]): PromptArgument[] =>
  names.map((name) => ({ name, description: null, required: false }))

describe('useArgumentSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Availability gate
  // -------------------------------------------------------------------------

  describe('availability gate', () => {
    it('does not call API when available is false', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: false }))
      const onUpdate = vi.fn()

      act(() => {
        result.current.suggestAll('template content', [], onUpdate)
      })

      expect(mockSuggestArguments).not.toHaveBeenCalled()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('does not call suggestName when available is false', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: false }))
      const onUpdate = vi.fn()

      act(() => {
        result.current.suggestName(0, 'content', [{ name: '', description: 'some desc', required: false }], onUpdate)
      })

      expect(mockSuggestArguments).not.toHaveBeenCalled()
    })

    it('does not call suggestDescription when available is false', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: false }))
      const onUpdate = vi.fn()

      act(() => {
        result.current.suggestDescription(0, 'content', [{ name: 'arg1', description: null, required: false }], onUpdate)
      })

      expect(mockSuggestArguments).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // suggestAll
  // -------------------------------------------------------------------------

  describe('suggestAll', () => {
    it('sends correct request shape', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'arg1', description: 'Desc 1' }] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestAll('Hello {{ name }}', makeArgs('name'), vi.fn())
      })

      expect(mockSuggestArguments).toHaveBeenCalledWith({
        prompt_content: 'Hello {{ name }}',
        arguments: [{ name: 'name', description: null }],
        target: null,
      })
    })

    it('calls onUpdate with suggested arguments', async () => {
      const suggestions = [
        { name: 'topic', description: 'The topic to write about' },
        { name: 'tone', description: 'Writing tone' },
      ]
      mockSuggestArguments.mockResolvedValue({ arguments: suggestions })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestAll('Write about {{ topic }} in {{ tone }}', [], onUpdate)
      })

      await vi.waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith(suggestions)
      })
    })

    it('sets isGeneratingAll during request', async () => {
      let resolvePromise: (value: { arguments: { name: string; description: string }[] }) => void
      mockSuggestArguments.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve }))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      act(() => {
        result.current.suggestAll('content', [], vi.fn())
      })

      expect(result.current.isGeneratingAll).toBe(true)

      await act(async () => {
        resolvePromise!({ arguments: [] })
      })

      await vi.waitFor(() => {
        expect(result.current.isGeneratingAll).toBe(false)
      })
    })
  })

  // -------------------------------------------------------------------------
  // suggestName
  // -------------------------------------------------------------------------

  describe('suggestName', () => {
    it('sends target as current argument name', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'suggested_name', description: 'desc' }] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: 'old_name', description: 'A description', required: false }]

      await act(async () => {
        result.current.suggestName(0, 'template', args, vi.fn())
      })

      expect(mockSuggestArguments).toHaveBeenCalledWith({
        prompt_content: 'template',
        arguments: [{ name: 'old_name', description: 'A description' }],
        target: 'old_name',
      })
    })

    it('sends empty string as target when name is empty', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'suggested', description: 'desc' }] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: '', description: 'A description', required: false }]

      await act(async () => {
        result.current.suggestName(0, null, args, vi.fn())
      })

      expect(mockSuggestArguments).toHaveBeenCalledWith({
        prompt_content: null,
        arguments: [{ name: null, description: 'A description' }],
        target: '',
      })
    })

    it('calls onUpdate with suggested name', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'better_name', description: 'desc' }] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestName(0, 'content', [{ name: '', description: 'desc', required: false }], onUpdate)
      })

      await vi.waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('better_name')
      })
    })

    it('sets suggestingIndex and suggestingField during request', async () => {
      let resolvePromise: (value: { arguments: { name: string; description: string }[] }) => void
      mockSuggestArguments.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve }))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      act(() => {
        result.current.suggestName(2, 'content', makeArgs('a', 'b', 'c'), vi.fn())
      })

      expect(result.current.suggestingIndex).toBe(2)
      expect(result.current.suggestingField).toBe('name')

      await act(async () => {
        resolvePromise!({ arguments: [{ name: 'x', description: 'y' }] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingIndex).toBeNull()
        expect(result.current.suggestingField).toBeNull()
      })
    })

    it('does not call onUpdate when response has no arguments', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestName(0, 'content', [{ name: 'arg', description: 'desc', required: false }], onUpdate)
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingIndex).toBeNull()
      })

      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // suggestDescription
  // -------------------------------------------------------------------------

  describe('suggestDescription', () => {
    it('sends target as current argument name', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'arg1', description: 'new desc' }] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: 'arg1', description: null, required: false }]

      await act(async () => {
        result.current.suggestDescription(0, 'template', args, vi.fn())
      })

      expect(mockSuggestArguments).toHaveBeenCalledWith({
        prompt_content: 'template',
        arguments: [{ name: 'arg1', description: null }],
        target: 'arg1',
      })
    })

    it('calls onUpdate with suggested description', async () => {
      mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'arg1', description: 'AI generated desc' }] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestDescription(0, 'content', [{ name: 'arg1', description: null, required: false }], onUpdate)
      })

      await vi.waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith('AI generated desc')
      })
    })

    it('sets suggestingField to description during request', async () => {
      let resolvePromise: (value: { arguments: { name: string; description: string }[] }) => void
      mockSuggestArguments.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve }))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      act(() => {
        result.current.suggestDescription(1, 'content', makeArgs('a', 'b'), vi.fn())
      })

      expect(result.current.suggestingIndex).toBe(1)
      expect(result.current.suggestingField).toBe('description')

      await act(async () => {
        resolvePromise!({ arguments: [{ name: 'b', description: 'desc' }] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingField).toBeNull()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('logs error silently on suggestAll failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestArguments.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestAll('content', [], onUpdate)
      })

      await vi.waitFor(() => {
        expect(result.current.isGeneratingAll).toBe(false)
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch argument suggestions:', expect.any(Error))
      expect(onUpdate).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('logs error silently on suggestName failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestArguments.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestName(0, 'content', [{ name: 'arg', description: 'desc', required: false }], onUpdate)
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingIndex).toBeNull()
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch argument name suggestion:', expect.any(Error))
      expect(onUpdate).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('logs error silently on suggestDescription failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestArguments.mockRejectedValue(new Error('API error'))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestDescription(0, 'content', [{ name: 'arg', description: null, required: false }], onUpdate)
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingIndex).toBeNull()
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch argument description suggestion:', expect.any(Error))
      expect(onUpdate).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // Race conditions
  // -------------------------------------------------------------------------

  describe('race conditions', () => {
    it('discards stale suggestAll response when a newer request is in flight', async () => {
      let resolveA: (value: { arguments: { name: string; description: string }[] }) => void
      let resolveB: (value: { arguments: { name: string; description: string }[] }) => void

      mockSuggestArguments
        .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdateA = vi.fn()
      const onUpdateB = vi.fn()

      // Start request A
      act(() => {
        result.current.suggestAll('content A', [], onUpdateA)
      })

      // Start request B (supersedes A)
      act(() => {
        result.current.suggestAll('content B', [], onUpdateB)
      })

      // B resolves first
      await act(async () => {
        resolveB!({ arguments: [{ name: 'b_arg', description: 'from B' }] })
      })

      await vi.waitFor(() => {
        expect(onUpdateB).toHaveBeenCalledWith([{ name: 'b_arg', description: 'from B' }])
      })

      // A resolves later — should be discarded
      await act(async () => {
        resolveA!({ arguments: [{ name: 'a_arg', description: 'from A' }] })
      })

      expect(onUpdateA).not.toHaveBeenCalled()
    })

    it('discards stale individual suggestion when a newer request starts', async () => {
      let resolveA: (value: { arguments: { name: string; description: string }[] }) => void
      let resolveB: (value: { arguments: { name: string; description: string }[] }) => void

      mockSuggestArguments
        .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdateA = vi.fn()
      const onUpdateB = vi.fn()

      // Start suggestName for arg 0
      act(() => {
        result.current.suggestName(0, 'content', makeArgs('a'), onUpdateA)
      })

      // Start suggestDescription for arg 1 (supersedes)
      act(() => {
        result.current.suggestDescription(1, 'content', makeArgs('a', 'b'), onUpdateB)
      })

      // B resolves
      await act(async () => {
        resolveB!({ arguments: [{ name: 'b', description: 'new desc' }] })
      })

      await vi.waitFor(() => {
        expect(onUpdateB).toHaveBeenCalledWith('new desc')
      })

      // A resolves later — discarded
      await act(async () => {
        resolveA!({ arguments: [{ name: 'new_a', description: 'desc' }] })
      })

      expect(onUpdateA).not.toHaveBeenCalled()
    })

    it('clears isGeneratingAll when suggestName starts during generate-all', async () => {
      let resolveAll: (value: { arguments: { name: string; description: string }[] }) => void
      mockSuggestArguments
        .mockReturnValueOnce(new Promise((resolve) => { resolveAll = resolve }))
        .mockResolvedValueOnce({ arguments: [{ name: 'suggested', description: 'desc' }] })

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      // Start generate-all
      act(() => {
        result.current.suggestAll('content', [], vi.fn())
      })
      expect(result.current.isGeneratingAll).toBe(true)

      // Start suggestName while generate-all is in flight
      await act(async () => {
        result.current.suggestName(0, 'content', [{ name: '', description: 'desc', required: false }], vi.fn())
      })

      // isGeneratingAll should be cleared immediately
      expect(result.current.isGeneratingAll).toBe(false)

      // Resolve the stale generate-all — should not re-set isGeneratingAll
      await act(async () => {
        resolveAll!({ arguments: [] })
      })
      expect(result.current.isGeneratingAll).toBe(false)
    })

    it('clears suggestingIndex when suggestAll starts during individual suggestion', async () => {
      let resolveName: (value: { arguments: { name: string; description: string }[] }) => void
      mockSuggestArguments
        .mockReturnValueOnce(new Promise((resolve) => { resolveName = resolve }))
        .mockResolvedValueOnce({ arguments: [{ name: 'arg', description: 'desc' }] })

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      // Start suggestName
      act(() => {
        result.current.suggestName(0, 'content', [{ name: '', description: 'desc', required: false }], vi.fn())
      })
      expect(result.current.suggestingIndex).toBe(0)

      // Start suggestAll while suggestName is in flight
      await act(async () => {
        result.current.suggestAll('content', [], vi.fn())
      })

      // suggestingIndex should be cleared immediately
      expect(result.current.suggestingIndex).toBeNull()
      expect(result.current.suggestingField).toBeNull()

      // Resolve the stale suggestName — should not re-set suggestingIndex
      await act(async () => {
        resolveName!({ arguments: [{ name: 'x', description: 'y' }] })
      })
      expect(result.current.suggestingIndex).toBeNull()
    })
  })
})
