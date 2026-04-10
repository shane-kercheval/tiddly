/**
 * Composition hook that wires useArgumentSuggestions into the Prompt component.
 *
 * Returns props to spread onto ArgumentsBuilder, keeping AI wiring out of
 * the main component.
 */
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useArgumentSuggestions } from './useArgumentSuggestions'
import type { PromptArgument } from '../types'

interface PromptLikeState {
  content: string
  arguments: PromptArgument[]
}

interface ArgumentSuggestionProps {
  onSuggestAll: () => void
  isSuggestingAll: boolean
  suggestAllDisabled: boolean
  suggestAllTooltip: string
  onSuggestName: (index: number) => void
  onSuggestDescription: (index: number) => void
  suggestingIndex: number | null
  suggestingField: 'name' | 'description' | null
}

interface UseAIArgumentIntegrationReturn {
  /** Props to spread onto ArgumentsBuilder. Undefined when AI not available (hides icons). */
  argumentSuggestProps: ArgumentSuggestionProps | undefined
}

export function useAIArgumentIntegration<T extends PromptLikeState>(
  current: T,
  setCurrent: Dispatch<SetStateAction<T>>,
  available: boolean,
): UseAIArgumentIntegrationReturn {
  const {
    isGeneratingAll,
    suggestingIndex,
    suggestingField,
    suggestAll,
    suggestName,
    suggestDescription,
  } = useArgumentSuggestions({ available })

  const hasContent = current.content.trim().length > 0
  // Quick check for {{ placeholder }} — skip the request entirely if none exist.
  // The backend would return early too, but this avoids a wasted network request
  // and rate limit consumption.
  const hasPlaceholders = /\{\{\s*\w+\s*\}\}/.test(current.content)

  const handleSuggestAll = useCallback((): void => {
    suggestAll(current.content, current.arguments, (newArgs) => {
      setCurrent((prev) => ({
        ...prev,
        arguments: [
          ...prev.arguments,
          ...newArgs.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
          })),
        ],
      }))
    })
  }, [current.content, current.arguments, suggestAll, setCurrent])

  const handleSuggestName = useCallback((index: number): void => {
    suggestName(
      index,
      current.content || null,
      current.arguments,
      (name) => {
        setCurrent((prev) => ({
          ...prev,
          arguments: prev.arguments.map((arg, i) =>
            i === index ? { ...arg, name } : arg
          ),
        }))
      },
    )
  }, [current.content, current.arguments, suggestName, setCurrent])

  const handleSuggestDescription = useCallback((index: number): void => {
    suggestDescription(
      index,
      current.content || null,
      current.arguments,
      (description) => {
        setCurrent((prev) => ({
          ...prev,
          arguments: prev.arguments.map((arg, i) =>
            i === index ? { ...arg, description } : arg
          ),
        }))
      },
    )
  }, [current.content, current.arguments, suggestDescription, setCurrent])

  if (!available) {
    return { argumentSuggestProps: undefined }
  }

  return {
    argumentSuggestProps: {
      onSuggestAll: handleSuggestAll,
      isSuggestingAll: isGeneratingAll,
      suggestAllDisabled: !hasContent || !hasPlaceholders,
      suggestAllTooltip: !hasContent
        ? 'Add prompt content to enable AI argument generation'
        : !hasPlaceholders
          ? 'No {{ placeholders }} found in template'
          : 'Generate arguments from template',
      onSuggestName: handleSuggestName,
      onSuggestDescription: handleSuggestDescription,
      suggestingIndex,
      suggestingField,
    },
  }
}
