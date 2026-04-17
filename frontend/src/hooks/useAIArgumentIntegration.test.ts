/**
 * Tests for useAIArgumentIntegration hook.
 *
 * Covers:
 * - Returns undefined argumentSuggestProps when AI not available
 * - Returns props when AI available
 * - suggestAllDisabled reflects prompt content state
 * - handleSuggestAll appends arguments to state
 * - handleSuggestName updates correct argument name
 * - handleSuggestDescription updates correct argument description
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAIArgumentIntegration } from './useAIArgumentIntegration'
import type { PromptArgument } from '../types'

const mockSuggestArguments = vi.fn()

vi.mock('../services/aiApi', () => ({
  suggestArguments: (...args: unknown[]) => mockSuggestArguments(...args),
}))

interface TestState {
  content: string
  arguments: PromptArgument[]
}

describe('useAIArgumentIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    expect(result.current.argumentSuggestProps).toBeDefined()
    expect(result.current.argumentSuggestProps!.onSuggestAll).toBeTypeOf('function')
    expect(result.current.argumentSuggestProps!.onSuggestName).toBeTypeOf('function')
    expect(result.current.argumentSuggestProps!.onSuggestDescription).toBeTypeOf('function')
  })

  it('suggestAllDisabled is true when content is empty', () => {
    const state: TestState = { content: '', arguments: [] }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    expect(result.current.argumentSuggestProps!.suggestAllDisabled).toBe(true)
  })

  it('suggestAllDisabled is true when content is whitespace only', () => {
    const state: TestState = { content: '   ', arguments: [] }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    expect(result.current.argumentSuggestProps!.suggestAllDisabled).toBe(true)
  })

  it('suggestAllDisabled is false when content exists', () => {
    const state: TestState = { content: 'Hello {{ name }}', arguments: [] }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    expect(result.current.argumentSuggestProps!.suggestAllDisabled).toBe(false)
  })

  it('handleSuggestAll appends suggested arguments to state', async () => {
    const suggestions = [
      { name: 'topic', description: 'The topic', required: true },
      { name: 'tone', description: 'The tone', required: false },
    ]
    mockSuggestArguments.mockResolvedValue({ arguments: suggestions })

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

    // Get the updater function and call it with mock prev state
    const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
    const newState = updater(state)

    expect(newState.arguments).toHaveLength(3)
    expect(newState.arguments[0]).toEqual({ name: 'existing', description: 'Already here', required: true })
    expect(newState.arguments[1]).toEqual({ name: 'topic', description: 'The topic', required: true })
    expect(newState.arguments[2]).toEqual({ name: 'tone', description: 'The tone', required: false })
  })

  it('handleSuggestName updates name without modifying required', async () => {
    mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'better_name', description: 'desc', required: true }] })

    const state: TestState = {
      content: 'content',
      arguments: [
        { name: 'arg1', description: 'First', required: false },
        { name: '', description: 'Second desc', required: true },
      ],
    }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    await act(async () => {
      result.current.argumentSuggestProps!.onSuggestName(1)
    })

    await vi.waitFor(() => {
      expect(setCurrent).toHaveBeenCalled()
    })

    const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
    const newState = updater(state)

    expect(newState.arguments[0].name).toBe('arg1')
    expect(newState.arguments[1].name).toBe('better_name')
    // required is preserved from user's original value, not overwritten by LLM response
    expect(newState.arguments[1].required).toBe(true)
  })

  it('handleSuggestDescription updates description without modifying required', async () => {
    mockSuggestArguments.mockResolvedValue({ arguments: [{ name: 'arg1', description: 'AI description', required: true }] })

    const state: TestState = {
      content: 'content',
      arguments: [
        { name: 'arg1', description: null, required: false },
        { name: 'arg2', description: null, required: true },
      ],
    }
    const setCurrent = vi.fn()

    const { result } = renderHook(() =>
      useAIArgumentIntegration(state, setCurrent, true),
    )

    await act(async () => {
      result.current.argumentSuggestProps!.onSuggestDescription(0)
    })

    await vi.waitFor(() => {
      expect(setCurrent).toHaveBeenCalled()
    })

    const updater = setCurrent.mock.calls[0][0] as (prev: TestState) => TestState
    const newState = updater(state)

    expect(newState.arguments[0].description).toBe('AI description')
    // required is preserved from user's original value, not overwritten by LLM response
    expect(newState.arguments[0].required).toBe(false)
    expect(newState.arguments[1].description).toBeNull()
  })
})
