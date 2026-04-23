/**
 * Tests for useAIArgumentIntegration hook.
 *
 * Covers:
 * - Availability gate: argumentSuggestProps undefined when AI unavailable.
 * - suggestAll passthrough.
 * - handleSuggestRow:
 *   - Live-state merge via `setCurrent(prev => ...)`: only patches fields
 *     that (a) the caller asked to generate AND (b) are still blank in live
 *     state at resolution time — preserves mid-flight edits.
 *   - `required` applied only in the two-field regenerate-from-blank path,
 *     and only when the live row is still observably blank at resolution.
 *   - Silent discard when the targeted row is removed mid-flight.
 * - rowSuggestDisabled and rowSuggestTooltip state-awareness across all
 *   meaningful row states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAIArgumentIntegration } from './useAIArgumentIntegration'
import { ROW_TOOLTIPS } from './useAIArgumentIntegration'
import type { PromptArgument, ArgumentSuggestion } from '../types'

const mockSuggestPromptArguments = vi.fn()
const mockSuggestPromptArgumentFields = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestPromptArguments: (...args: unknown[]) => mockSuggestPromptArguments(...args),
  suggestPromptArgumentFields: (...args: unknown[]) => mockSuggestPromptArgumentFields(...args),
}))

interface TestState {
  content: string
  arguments: PromptArgument[]
}

function makeSuggestion(overrides: Partial<ArgumentSuggestion> = {}): ArgumentSuggestion {
  return { name: 'x', description: 'y', required: false, ...overrides }
}

describe('useAIArgumentIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Availability gate
  // -------------------------------------------------------------------------

  it('returns undefined argumentSuggestProps when AI not available', () => {
    const state: TestState = { content: 'Hello {{ name }}', arguments: [] }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, false),
    )

    expect(result.current.argumentSuggestProps).toBeUndefined()
  })

  it('returns props when AI available', () => {
    const state: TestState = { content: 'Hello {{ name }}', arguments: [] }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    const props = result.current.argumentSuggestProps
    expect(props).toBeDefined()
    expect(props!.onSuggestAll).toBeTypeOf('function')
    expect(props!.onSuggestRow).toBeTypeOf('function')
    expect(props!.rowSuggestDisabled).toBeTypeOf('function')
    expect(props!.rowSuggestTooltip).toBeTypeOf('function')
    expect(props!.isSuggestingRow).toBeTypeOf('function')
  })

  // -------------------------------------------------------------------------
  // suggestAllDisabled (preserved from pre-M3)
  // -------------------------------------------------------------------------

  describe('suggestAllDisabled', () => {
    it('true when content is empty', () => {
      const state: TestState = { content: '', arguments: [] }
      const { result } = renderHook(() =>
        useAIArgumentIntegration(state, vi.fn(), true),
      )
      expect(result.current.argumentSuggestProps!.suggestAllDisabled).toBe(true)
    })

    it('true when content is whitespace only', () => {
      const state: TestState = { content: '   ', arguments: [] }
      const { result } = renderHook(() =>
        useAIArgumentIntegration(state, vi.fn(), true),
      )
      expect(result.current.argumentSuggestProps!.suggestAllDisabled).toBe(true)
    })

    it('false when content contains placeholders', () => {
      const state: TestState = { content: 'Hello {{ name }}', arguments: [] }
      const { result } = renderHook(() =>
        useAIArgumentIntegration(state, vi.fn(), true),
      )
      expect(result.current.argumentSuggestProps!.suggestAllDisabled).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // handleSuggestAll (preserved from pre-M3)
  // -------------------------------------------------------------------------

  it('handleSuggestAll appends suggested arguments to state', async () => {
    const suggestions = [
      makeSuggestion({ name: 'topic', description: 'The topic', required: true }),
      makeSuggestion({ name: 'tone', description: 'The tone', required: false }),
    ]
    mockSuggestPromptArguments.mockResolvedValue({ arguments: suggestions })

    const state: TestState = {
      content: 'Write about {{ topic }} in {{ tone }}',
      arguments: [{ name: 'existing', description: 'Already here', required: true }],
    }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    await act(async () => {
      result.current.argumentSuggestProps!.onSuggestAll()
    })

    await vi.waitFor(() => {
      expect(setCurrent).toHaveBeenCalled()
    })

    const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
    const newState = updater(state)

    expect(newState.arguments).toHaveLength(3)
    expect(newState.arguments[1]).toEqual({ name: 'topic', description: 'The topic', required: true })
    expect(newState.arguments[2]).toEqual({ name: 'tone', description: 'The tone', required: false })
  })

  // -------------------------------------------------------------------------
  // handleSuggestRow — live-state merge semantics
  // -------------------------------------------------------------------------

  describe('handleSuggestRow — live-state merge', () => {
    it('patches only the blank field (single-field path) and does NOT touch required', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion({ name: 'better_name', required: true })],
      })

      const state: TestState = {
        content: 'content',
        arguments: [{ name: '', description: 'Second desc', required: true }],
      }
      const setCurrent = vi.fn()

      const { result } = renderHook(() =>
        useAIArgumentIntegration(state, setCurrent, true),
      )

      await act(async () => {
        result.current.argumentSuggestProps!.onSuggestRow(0)
      })

      await vi.waitFor(() => {
        expect(setCurrent).toHaveBeenCalled()
      })

      const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
      const newState = updater(state)

      expect(newState.arguments[0].name).toBe('better_name')
      expect(newState.arguments[0].description).toBe('Second desc')
      // required preserved — single-field path never propagates it.
      expect(newState.arguments[0].required).toBe(true)
    })

    it('preserves a mid-flight name edit (live-state merge wins over stale patch)', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion({ name: 'llm_name' })],
      })

      const callTimeState: TestState = {
        content: 'content',
        arguments: [{ name: '', description: 'desc', required: false }],
      }
      const midFlightState: TestState = {
        content: 'content',
        arguments: [{ name: 'user_typed', description: 'desc', required: false }],
      }
      const setCurrent = vi.fn()

      const { result } = renderHook(() =>
        useAIArgumentIntegration(callTimeState, setCurrent, true),
      )

      await act(async () => {
        result.current.argumentSuggestProps!.onSuggestRow(0)
      })

      await vi.waitFor(() => {
        expect(setCurrent).toHaveBeenCalled()
      })

      // Simulate the updater running against LIVE state (user typed mid-flight).
      const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
      const newState = updater(midFlightState)

      // User's typed name survives; LLM's suggestion is dropped because the
      // live row is no longer blank in that field.
      expect(newState.arguments[0].name).toBe('user_typed')
    })

    it('discards silently when the targeted row is removed mid-flight', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion()],
      })

      const callTimeState: TestState = {
        content: 'content',
        arguments: [{ name: '', description: 'desc', required: false }],
      }
      const liveStateAfterRemoval: TestState = {
        content: 'content',
        arguments: [],  // row removed
      }
      const setCurrent = vi.fn()

      const { result } = renderHook(() =>
        useAIArgumentIntegration(callTimeState, setCurrent, true),
      )

      await act(async () => {
        result.current.argumentSuggestProps!.onSuggestRow(0)
      })

      await vi.waitFor(() => {
        expect(setCurrent).toHaveBeenCalled()
      })

      const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
      const newState = updater(liveStateAfterRemoval)

      // Returns prev unchanged — no crash, no phantom row added.
      expect(newState).toBe(liveStateAfterRemoval)
    })

    it('two-field path applies required only when live row is still blank', async () => {
      mockSuggestPromptArgumentFields.mockResolvedValue({
        arguments: [makeSuggestion({ name: 'topic', description: 'The topic', required: true })],
      })

      const callTimeState: TestState = {
        content: 'Write about {{ topic }}',
        arguments: [{ name: '', description: null, required: false }],
      }
      const setCurrent = vi.fn()

      const { result } = renderHook(() =>
        useAIArgumentIntegration(callTimeState, setCurrent, true),
      )

      await act(async () => {
        result.current.argumentSuggestProps!.onSuggestRow(0)
      })

      await vi.waitFor(() => {
        expect(setCurrent).toHaveBeenCalled()
      })

      const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState

      // Case 1: live state still blank — required IS applied (from LLM).
      const blankLive: TestState = {
        content: 'Write about {{ topic }}',
        arguments: [{ name: '', description: null, required: false }],
      }
      const patchedBlank = updater(blankLive)
      expect(patchedBlank.arguments[0].required).toBe(true)
      expect(patchedBlank.arguments[0].name).toBe('topic')
      expect(patchedBlank.arguments[0].description).toBe('The topic')

      // Case 2: user typed a name mid-flight — required NOT touched,
      // name preserved, description patched (still blank).
      const partiallyEditedLive: TestState = {
        content: 'Write about {{ topic }}',
        arguments: [{ name: 'user_typed', description: null, required: false }],
      }
      const patchedPartial = updater(partiallyEditedLive)
      expect(patchedPartial.arguments[0].name).toBe('user_typed')
      expect(patchedPartial.arguments[0].description).toBe('The topic')
      expect(patchedPartial.arguments[0].required).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // rowSuggestDisabled + rowSuggestTooltip — state-aware
  // -------------------------------------------------------------------------

  describe('rowSuggestDisabled / rowSuggestTooltip', () => {
    function makeRendered(state: TestState): ReturnType<typeof renderHook<
      ReturnType<typeof useAIArgumentIntegration<TestState>>,
      unknown
    >> {
      return renderHook(() => useAIArgumentIntegration(state, vi.fn(), true))
    }

    it('only name blank + description populated → enabled, "Suggest name"', () => {
      const state: TestState = {
        content: '',
        arguments: [{ name: '', description: 'has desc', required: false }],
      }
      const { result } = makeRendered(state)
      const props = result.current.argumentSuggestProps!
      expect(props.rowSuggestDisabled(0)).toBe(false)
      expect(props.rowSuggestTooltip(0)).toBe(ROW_TOOLTIPS.suggestName)
    })

    it('only description blank + name populated → enabled, "Suggest description"', () => {
      const state: TestState = {
        content: '',
        arguments: [{ name: 'named', description: null, required: false }],
      }
      const { result } = makeRendered(state)
      const props = result.current.argumentSuggestProps!
      expect(props.rowSuggestDisabled(0)).toBe(false)
      expect(props.rowSuggestTooltip(0)).toBe(ROW_TOOLTIPS.suggestDescription)
    })

    it('both blank + template populated → enabled, "Suggest name and description"', () => {
      const state: TestState = {
        content: 'Write about {{ topic }}',
        arguments: [{ name: '', description: null, required: false }],
      }
      const { result } = makeRendered(state)
      const props = result.current.argumentSuggestProps!
      expect(props.rowSuggestDisabled(0)).toBe(false)
      expect(props.rowSuggestTooltip(0)).toBe(ROW_TOOLTIPS.suggestBoth)
    })

    it('both blank + no template → disabled, no-grounding tooltip', () => {
      const state: TestState = {
        content: '',
        arguments: [{ name: '', description: null, required: false }],
      }
      const { result } = makeRendered(state)
      const props = result.current.argumentSuggestProps!
      expect(props.rowSuggestDisabled(0)).toBe(true)
      expect(props.rowSuggestTooltip(0)).toBe(ROW_TOOLTIPS.noGrounding)
    })

    it('both populated → disabled, row-complete tooltip', () => {
      const state: TestState = {
        content: '',
        arguments: [{ name: 'named', description: 'has desc', required: false }],
      }
      const { result } = makeRendered(state)
      const props = result.current.argumentSuggestProps!
      expect(props.rowSuggestDisabled(0)).toBe(true)
      expect(props.rowSuggestTooltip(0)).toBe(ROW_TOOLTIPS.rowComplete)
    })

    it('whitespace-only fields count as blank for disabled/tooltip', () => {
      const state: TestState = {
        content: '',
        arguments: [{ name: '   ', description: '   ', required: false }],
      }
      const { result } = makeRendered(state)
      const props = result.current.argumentSuggestProps!
      // Whitespace everywhere with no template → disabled, no-grounding.
      expect(props.rowSuggestDisabled(0)).toBe(true)
      expect(props.rowSuggestTooltip(0)).toBe(ROW_TOOLTIPS.noGrounding)
    })
  })
})
