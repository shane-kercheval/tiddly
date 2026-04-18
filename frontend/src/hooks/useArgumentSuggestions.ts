/**
 * Hook for fetching AI argument suggestions.
 *
 * Two modes wiring two backend endpoints:
 * - suggestAll: `/ai/suggest-prompt-arguments` — generate entries for every
 *   new placeholder in the template. Appends via `onUpdate(newArgs)`.
 * - suggestRowFields: `/ai/suggest-prompt-argument-fields` — refine one row.
 *   Computes `target_fields` from which fields on that row are blank at
 *   call time, then fires the request. On success, calls
 *   `onUpdate(index, suggestion, targetFields)` — the hook does NOT merge
 *   against live state. Merge semantics ("patch only blank fields at
 *   resolution time") live in the integration layer where `setCurrent(prev => …)`
 *   gives access to live `prev`.
 *
 * No caching — each click should produce a fresh result.
 *
 * Cross-mode serialization: `suggestAll` and `suggestRowFields` share a
 * single `requestIdRef` that is bumped on every call. On resolution, the
 * callback is dropped if the ref has moved on (last-write-wins). This is
 * the defense-in-depth backstop to the hard button-disable gates in
 * `ArgumentsBuilder`; the two layers together eliminate cross-mode
 * response races.
 */
import { useState, useCallback, useRef } from 'react'
import { suggestPromptArguments, suggestPromptArgumentFields } from '../services/aiApi'
import { getRowBlanks } from './argumentBlanks'
import type { PromptArgument, ArgumentSuggestion } from '../types'

interface UseArgumentSuggestionsOptions {
  /** Whether AI is available for this user's tier. When false, all handlers are no-ops. */
  available?: boolean
}

export type TargetFields = Array<'name' | 'description'>

interface UseArgumentSuggestionsReturn {
  /** Whether a generate-all request is in flight. */
  isGeneratingAll: boolean
  /** Index of the row whose per-row suggestion is in flight, or null. */
  suggestingIndex: number | null
  /** True while any per-row suggestion is in flight. Derived from suggestingIndex. */
  suggestingAnyRow: boolean
  /** Generate arguments for all template placeholders. Appends to existing args via onUpdate. */
  suggestAll: (
    promptContent: string,
    existingArgs: PromptArgument[],
    onUpdate: (newArgs: ArgumentSuggestion[]) => void,
  ) => void
  /**
   * Refine one row. `target_fields` is computed from the row's blank
   * fields at call time. `onUpdate` receives the full suggestion and the
   * computed target_fields; the hook does not merge against live state.
   */
  suggestRowFields: (
    index: number,
    promptContent: string | null,
    existingArgs: PromptArgument[],
    onUpdate: (
      index: number,
      suggestion: ArgumentSuggestion,
      targetFields: TargetFields,
    ) => void,
  ) => void
}

function computeTargetFields(arg: PromptArgument): TargetFields {
  const { nameBlank, descBlank } = getRowBlanks(arg)
  const fields: TargetFields = []
  if (nameBlank) fields.push('name')
  if (descBlank) fields.push('description')
  return fields
}

export function useArgumentSuggestions(
  { available = true }: UseArgumentSuggestionsOptions = {},
): UseArgumentSuggestionsReturn {
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null)
  // Single shared request counter — bumped by every call in every mode.
  // On resolution, a handler is dropped when requestIdRef has moved on.
  // See the module-level docstring for the cross-mode race rationale.
  const requestIdRef = useRef(0)

  const suggestAll = useCallback((
    promptContent: string,
    existingArgs: PromptArgument[],
    onUpdate: (newArgs: ArgumentSuggestion[]) => void,
  ): void => {
    if (!available) return

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    // Clear any per-row loading state from a previous request.
    setSuggestingIndex(null)
    setIsGeneratingAll(true)

    suggestPromptArguments({
      prompt_content: promptContent,
      arguments: existingArgs.map((a) => ({
        name: a.name || null,
        description: a.description || null,
      })),
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId) {
          onUpdate(response.arguments)
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch argument suggestions:', error)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setIsGeneratingAll(false)
        }
      })
  }, [available])

  const suggestRowFields = useCallback((
    index: number,
    promptContent: string | null,
    existingArgs: PromptArgument[],
    onUpdate: (
      index: number,
      suggestion: ArgumentSuggestion,
      targetFields: TargetFields,
    ) => void,
  ): void => {
    if (!available) return
    const row = existingArgs[index]
    if (!row) return

    const targetFields = computeTargetFields(row)
    if (targetFields.length === 0) {
      // Defense-in-depth — the button should already be disabled when no
      // field is blank, but guard anyway against programmatic callers.
      return
    }
    // Defense-in-depth for the no-grounding case: when both row fields are
    // blank, only the template can ground the two-field path. Without it,
    // the backend's `model_validator` would 422 and we'd burn a network
    // round-trip for nothing. Mirror of the integration layer's
    // `rowSuggestDisabled` gating. Single-field paths (length === 1) are
    // always grounded by construction — they only fire when the opposite
    // field is non-blank.
    if (targetFields.length === 2 && !promptContent?.trim()) {
      return
    }

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    // Clear any generate-all loading state from a previous request.
    setIsGeneratingAll(false)
    setSuggestingIndex(index)

    suggestPromptArgumentFields({
      prompt_content: promptContent || null,
      arguments: existingArgs.map((a) => ({
        name: a.name || null,
        description: a.description || null,
      })),
      target_index: index,
      target_fields: targetFields,
    })
      .then((response) => {
        if (requestIdRef.current !== thisRequestId) return
        const suggestion = response.arguments[0]
        if (!suggestion) return
        onUpdate(index, suggestion, targetFields)
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch argument row suggestion:', error)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setSuggestingIndex(null)
        }
      })
  }, [available])

  return {
    isGeneratingAll,
    suggestingIndex,
    suggestingAnyRow: suggestingIndex !== null,
    suggestAll,
    suggestRowFields,
  }
}
