/**
 * Tests for useArgumentSuggestions hook.
 *
 * Covers:
 * - Availability gate: does not call API when available=false.
 * - suggestAll: posts to the plural endpoint, appends results via onUpdate,
 *   manages isGeneratingAll lifecycle, logs errors silently.
 * - suggestRowFields: computes target_fields from the row snapshot,
 *   no-ops when all fields are already populated, fires when at least one
 *   is blank, manages suggestingIndex/suggestingAnyRow lifecycle.
 * - Hook does NOT merge state — it passes `(index, suggestion, targetFields)`
 *   to onUpdate and lets the integration layer do the merge.
 * - Stale-response discard via shared requestIdRef across both modes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useArgumentSuggestions } from './useArgumentSuggestions'
import type { PromptArgument, ArgumentSuggestion } from '../types'

const mockSuggestPromptArguments = vi.fn()
const mockSuggestPromptArgumentFields = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestPromptArguments: (...args: unknown[]) => mockSuggestPromptArguments(...args),
  suggestPromptArgumentFields: (...args: unknown[]) => mockSuggestPromptArgumentFields(...args),
}))

const makeArgs = (...names: string[]): PromptArgument[] =>
  names.map((name) => ({ name, description: null, required: false }))

function makeSuggestion(overrides: Partial<ArgumentSuggestion> = {}): ArgumentSuggestion {
  return { name: 'x', description: 'y', required: false, ...overrides }
}

describe('useArgumentSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Availability gate
  // -------------------------------------------------------------------------

  describe('availability gate', () => {
    it('does not call API when available is false (suggestAll)', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: false }))
      act(() => {
        result.current.suggestAll('template content', [], vi.fn())
      })
      expect(mockSuggestPromptArguments).not.toHaveBeenCalled()
    })

    it('does not call API when available is false (suggestRowFields)', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: false }))
      const args: PromptArgument[] = [{ name: '', description: 'desc', required: false }]
      act(() => {
        result.current.suggestRowFields(0, 'content', args, vi.fn())
      })
      expect(mockSuggestPromptArgumentFields).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // suggestAll
  // -------------------------------------------------------------------------

  describe('suggestAll', () => {
    it('posts the correct request shape', async () => {
      mockSuggestPromptArguments.mockResolvedValue({ arguments: [makeSuggestion({ name: 'x' })] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      await act(async () => {
        result.current.suggestAll('Hello {{ name }}', makeArgs('name'), vi.fn())
      })

      expect(mockSuggestPromptArguments).toHaveBeenCalledWith({
        prompt_content: 'Hello {{ name }}',
        arguments: [{ name: 'name', description: null }],
      })
    })

    it('calls onUpdate with suggested arguments', async () => {
      const suggestions = [
        makeSuggestion({ name: 'topic', description: 'The topic to write about' }),
        makeSuggestion({ name: 'tone', description: 'Writing tone' }),
      ]
      mockSuggestPromptArguments.mockResolvedValue({ arguments: suggestions })
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
      let resolvePromise: (value: { arguments: ArgumentSuggestion[] }) => void
      mockSuggestPromptArguments.mockReturnValue(
        new Promise((resolve) => { resolvePromise = resolve }),
      )

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

    it('logs error silently on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSuggestPromptArguments.mockRejectedValue(new Error('API error'))

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
  })

  // -------------------------------------------------------------------------
  // suggestRowFields — target_fields derivation
  // -------------------------------------------------------------------------

  describe('suggestRowFields — target_fields derivation', () => {
    it('sends target_fields=["name"] when only name is blank', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion({ name: 'suggested' })],
      })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: '', description: 'A description', required: false }]

      await act(async () => {
        result.current.suggestRowFields(0, 'template', args, vi.fn())
      })

      expect(mockSuggestPromptArgumentFields).toHaveBeenCalledWith({
        prompt_content: 'template',
        arguments: [{ name: null, description: 'A description' }],
        target_index: 0,
        target_fields: ['name'],
      })
    })

    it('sends target_fields=["description"] when only description is blank', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion({ description: 'new desc' })],
      })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: 'arg1', description: null, required: false }]

      await act(async () => {
        result.current.suggestRowFields(0, 'template', args, vi.fn())
      })

      const call = mockSuggestPromptArgumentFields.mock.calls[0][0] as {
        target_fields: Array<'name' | 'description'>
      }
      expect(call.target_fields).toEqual(['description'])
    })

    it('sends target_fields=["name","description"] when both are blank AND template populated', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion({ name: 'topic', description: 'The topic' })],
      })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: '', description: null, required: false }]

      await act(async () => {
        result.current.suggestRowFields(0, 'Write about {{ topic }}', args, vi.fn())
      })

      const call = mockSuggestPromptArgumentFields.mock.calls[0][0] as {
        target_fields: Array<'name' | 'description'>
      }
      expect(call.target_fields).toEqual(['name', 'description'])
    })

    it('does not call API when neither field is blank (no-op)', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: 'arg1', description: 'desc', required: false }]

      act(() => {
        result.current.suggestRowFields(0, 'template', args, vi.fn())
      })

      expect(mockSuggestPromptArgumentFields).not.toHaveBeenCalled()
    })

    it('does not call API when row is empty AND template is empty (no-grounding no-op)', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: '', description: null, required: false }]

      act(() => {
        // Would compute target_fields=['name','description'] but there's no
        // grounding signal — defense-in-depth matches the UI's disable rule
        // and avoids a guaranteed-422 backend round-trip.
        result.current.suggestRowFields(0, null, args, vi.fn())
      })

      expect(mockSuggestPromptArgumentFields).not.toHaveBeenCalled()
    })

    it('does not call API when row is empty AND template is whitespace-only', () => {
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const args: PromptArgument[] = [{ name: '', description: null, required: false }]

      act(() => {
        result.current.suggestRowFields(0, '   ', args, vi.fn())
      })

      expect(mockSuggestPromptArgumentFields).not.toHaveBeenCalled()
    })

    it('whitespace-only fields count as blank (frontend pre-strip UX parity)', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion()],
      })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      // name is whitespace → treat as blank
      const args: PromptArgument[] = [{ name: '   ', description: 'desc', required: false }]

      await act(async () => {
        result.current.suggestRowFields(0, 'template', args, vi.fn())
      })

      const call = mockSuggestPromptArgumentFields.mock.calls[0][0] as {
        target_fields: Array<'name' | 'description'>
      }
      expect(call.target_fields).toEqual(['name'])
    })
  })

  // -------------------------------------------------------------------------
  // suggestRowFields — onUpdate contract
  // -------------------------------------------------------------------------

  describe('suggestRowFields — onUpdate contract', () => {
    it('passes full suggestion and targetFields to onUpdate (no state merging)', async () => {
      const suggestion = makeSuggestion({
        name: 'better_name', description: 'better desc', required: true,
      })
      mockSuggestPromptArgumentFields.mockResolvedValue({ arguments: [suggestion] })

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestRowFields(
          0,
          null,
          [{ name: '', description: 'orig desc', required: false }],
          onUpdate,
        )
      })

      await vi.waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith(0, suggestion, ['name'])
      })
    })

    it('does not call onUpdate when response has no arguments', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({ arguments: [] })
      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const onUpdate = vi.fn()

      await act(async () => {
        result.current.suggestRowFields(
          0, 'content', [{ name: '', description: 'desc', required: false }], onUpdate,
        )
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingIndex).toBeNull()
      })
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // suggestingIndex / suggestingAnyRow lifecycle
  // -------------------------------------------------------------------------

  describe('suggesting* lifecycle', () => {
    it('suggestingAnyRow flips true during in-flight, false after resolve', async () => {
      let resolvePromise: (value: { arguments: ArgumentSuggestion[] }) => void
      mockSuggestPromptArgumentFields.mockReturnValue(
        new Promise((resolve) => { resolvePromise = resolve }),
      )

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      act(() => {
        result.current.suggestRowFields(
          1,
          'content',
          makeArgs('a', 'b'),
          vi.fn(),
        )
      })

      // `b` has no description, so target_fields=['description'] — fires.
      expect(result.current.suggestingAnyRow).toBe(true)
      expect(result.current.suggestingIndex).toBe(1)

      await act(async () => {
        resolvePromise!({ arguments: [makeSuggestion({ name: 'b', description: 'desc' })] })
      })

      await vi.waitFor(() => {
        expect(result.current.suggestingAnyRow).toBe(false)
        expect(result.current.suggestingIndex).toBeNull()
      })
    })

    it('clears isGeneratingAll when suggestRowFields starts during generate-all', async () => {
      let resolveAll: (value: { arguments: ArgumentSuggestion[] }) => void
      mockSuggestPromptArguments.mockReturnValue(
        new Promise((resolve) => { resolveAll = resolve }),
      )
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion()],
      })

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))

      act(() => {
        result.current.suggestAll('content', [], vi.fn())
      })
      expect(result.current.isGeneratingAll).toBe(true)

      await act(async () => {
        result.current.suggestRowFields(
          0,
          'content',
          [{ name: '', description: 'desc', required: false }],
          vi.fn(),
        )
      })

      // isGeneratingAll cleared immediately when a per-row call starts.
      expect(result.current.isGeneratingAll).toBe(false)

      // Late-resolve of generate-all does not re-set the flag (stale).
      await act(async () => {
        resolveAll!({ arguments: [] })
      })
      expect(result.current.isGeneratingAll).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Cross-mode stale-response discard
  // -------------------------------------------------------------------------

  describe('stale-response discard via shared requestIdRef', () => {
    it('discards a stale suggestRowFields response after suggestAll supersedes it', async () => {
      let resolveRow: (value: { arguments: ArgumentSuggestion[] }) => void
      let resolveAll: (value: { arguments: ArgumentSuggestion[] }) => void
      mockSuggestPromptArgumentFields.mockReturnValue(
        new Promise((resolve) => { resolveRow = resolve }),
      )
      mockSuggestPromptArguments.mockReturnValue(
        new Promise((resolve) => { resolveAll = resolve }),
      )

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const rowOnUpdate = vi.fn()
      const allOnUpdate = vi.fn()

      // Fire row request (A)
      act(() => {
        result.current.suggestRowFields(
          0, 'content', [{ name: '', description: 'desc', required: false }], rowOnUpdate,
        )
      })
      // Fire generate-all (B), superseding A.
      act(() => {
        result.current.suggestAll('content', [], allOnUpdate)
      })
      // Resolve B first (current request).
      await act(async () => {
        resolveAll!({ arguments: [] })
      })
      await vi.waitFor(() => {
        expect(allOnUpdate).toHaveBeenCalled()
      })
      // Now resolve A — should be discarded.
      await act(async () => {
        resolveRow!({ arguments: [makeSuggestion({ name: 'stale' })] })
      })
      expect(rowOnUpdate).not.toHaveBeenCalled()
    })

    it('discards a stale suggestAll response after suggestRowFields supersedes it', async () => {
      let resolveAll: (value: { arguments: ArgumentSuggestion[] }) => void
      let resolveRow: (value: { arguments: ArgumentSuggestion[] }) => void
      mockSuggestPromptArguments.mockReturnValue(
        new Promise((resolve) => { resolveAll = resolve }),
      )
      mockSuggestPromptArgumentFields.mockReturnValue(
        new Promise((resolve) => { resolveRow = resolve }),
      )

      const { result } = renderHook(() => useArgumentSuggestions({ available: true }))
      const allOnUpdate = vi.fn()
      const rowOnUpdate = vi.fn()

      act(() => {
        result.current.suggestAll('content', [], allOnUpdate)
      })
      act(() => {
        result.current.suggestRowFields(
          0, 'content', [{ name: '', description: 'desc', required: false }], rowOnUpdate,
        )
      })

      await act(async () => {
        resolveRow!({ arguments: [makeSuggestion({ name: 'row-name' })] })
      })
      await vi.waitFor(() => {
        expect(rowOnUpdate).toHaveBeenCalled()
      })
      await act(async () => {
        resolveAll!({ arguments: [makeSuggestion({ name: 'stale' })] })
      })
      expect(allOnUpdate).not.toHaveBeenCalled()
    })
  })
})
