/**
 * Hook for fetching AI argument suggestions.
 *
 * Three modes:
 * - suggestAll: Generate arguments for all template placeholders (no target)
 * - suggestName: Suggest a name for a specific argument (target_index = row index)
 * - suggestDescription: Suggest a description for a specific argument (target_index = row index)
 *
 * No caching — argument suggestions replace content, so each click should
 * produce a fresh result (same rationale as metadata suggestions).
 *
 * Known limitations:
 * - Overwrite during loading: If the user edits a field while a suggestion is
 *   in flight, the response overwrites their edits. Same tradeoff exists in
 *   metadata suggestions (useMetadataSuggestions). A cross-cutting fix would
 *   apply to all suggestion types.
 */
import { useState, useCallback, useRef } from 'react'
import { suggestArguments } from '../services/aiApi'
import type { PromptArgument, ArgumentSuggestion } from '../types'

interface UseArgumentSuggestionsOptions {
  /** Whether AI is available for this user's tier. When false, all handlers are no-ops. */
  available?: boolean
}

interface UseArgumentSuggestionsReturn {
  /** Whether a generate-all request is in flight. */
  isGeneratingAll: boolean
  /** Index of the argument whose name/description is being suggested, or null. */
  suggestingIndex: number | null
  /** Which field is being suggested for the argument at suggestingIndex. */
  suggestingField: 'name' | 'description' | null
  /** Generate arguments for all template placeholders. Appends to existing args via onUpdate. */
  suggestAll: (
    promptContent: string,
    existingArgs: PromptArgument[],
    onUpdate: (newArgs: ArgumentSuggestion[]) => void,
  ) => void
  /** Suggest a name for a specific argument. */
  suggestName: (
    index: number,
    promptContent: string | null,
    existingArgs: PromptArgument[],
    onUpdate: (name: string) => void,
  ) => void
  /** Suggest a description for a specific argument. */
  suggestDescription: (
    index: number,
    promptContent: string | null,
    existingArgs: PromptArgument[],
    onUpdate: (description: string) => void,
  ) => void
}

export function useArgumentSuggestions(
  { available = true }: UseArgumentSuggestionsOptions = {},
): UseArgumentSuggestionsReturn {
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null)
  const [suggestingField, setSuggestingField] = useState<'name' | 'description' | null>(null)
  const requestIdRef = useRef(0)

  const suggestAll = useCallback((
    promptContent: string,
    existingArgs: PromptArgument[],
    onUpdate: (newArgs: ArgumentSuggestion[]) => void,
  ): void => {
    if (!available) return

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    // Clear any per-argument loading state from a previous request
    setSuggestingIndex(null)
    setSuggestingField(null)
    setIsGeneratingAll(true)

    suggestArguments({
      prompt_content: promptContent,
      arguments: existingArgs.map((a) => ({
        name: a.name || null,
        description: a.description || null,
      })),
      target_index: null,
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

  const suggestName = useCallback((
    index: number,
    promptContent: string | null,
    existingArgs: PromptArgument[],
    onUpdate: (name: string) => void,
  ): void => {
    if (!available) return

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    // Clear any generate-all loading state from a previous request
    setIsGeneratingAll(false)
    setSuggestingIndex(index)
    setSuggestingField('name')

    suggestArguments({
      prompt_content: promptContent || null,
      arguments: existingArgs.map((a) => ({
        name: a.name || null,
        description: a.description || null,
      })),
      target_index: index,
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId && response.arguments.length > 0) {
          onUpdate(response.arguments[0].name)
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch argument name suggestion:', error)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setSuggestingIndex(null)
          setSuggestingField(null)
        }
      })
  }, [available])

  const suggestDescription = useCallback((
    index: number,
    promptContent: string | null,
    existingArgs: PromptArgument[],
    onUpdate: (description: string) => void,
  ): void => {
    if (!available) return

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    // Clear any generate-all loading state from a previous request
    setIsGeneratingAll(false)
    setSuggestingIndex(index)
    setSuggestingField('description')

    suggestArguments({
      prompt_content: promptContent || null,
      arguments: existingArgs.map((a) => ({
        name: a.name || null,
        description: a.description || null,
      })),
      target_index: index,
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId && response.arguments.length > 0) {
          onUpdate(response.arguments[0].description)
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch argument description suggestion:', error)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setSuggestingIndex(null)
          setSuggestingField(null)
        }
      })
  }, [available])

  return {
    isGeneratingAll,
    suggestingIndex,
    suggestingField,
    suggestAll,
    suggestName,
    suggestDescription,
  }
}
