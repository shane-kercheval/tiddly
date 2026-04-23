/**
 * Shared AI metadata suggestion integration for detail components.
 *
 * Composes useMetadataSuggestions and returns ready-to-use props for
 * InlineEditableTitle and InlineEditableText (onSuggest, isSuggesting,
 * suggestDisabled, suggestTooltip).
 *
 * The caller passes `available` (from useAIAvailability) so this hook
 * doesn't depend on React Query directly.
 *
 * Used by Bookmark, Note, and Prompt detail components.
 */
import { useCallback } from 'react'
import { useMetadataSuggestions } from './useMetadataSuggestions'

interface MetadataState {
  title: string
  description: string
  content: string
  url?: string
}

interface SuggestIconProps {
  onSuggest: () => void
  isSuggesting: boolean
  suggestDisabled: boolean
  suggestTooltip: string
}

interface UseAIMetadataIntegrationReturn {
  /** Props to spread on InlineEditableTitle. Undefined when AI not available. */
  titleSuggestProps: SuggestIconProps | undefined
  /** Props to spread on InlineEditableText (description). Undefined when AI not available. */
  descriptionSuggestProps: SuggestIconProps | undefined
}

export function useAIMetadataIntegration<T extends MetadataState>(
  current: T,
  setCurrent: React.Dispatch<React.SetStateAction<T>>,
  available: boolean = false,
): UseAIMetadataIntegrationReturn {
  const { isSuggestingTitle, isSuggestingDescription, suggestTitle, suggestDescription } = useMetadataSuggestions({ available })

  const handleUpdate = useCallback((title: string | null, description: string | null) => {
    setCurrent((prev) => ({
      ...prev,
      ...(title != null ? { title } : {}),
      ...(description != null ? { description } : {}),
    }))
  }, [setCurrent])

  const handleSuggestTitle = useCallback(() => {
    suggestTitle(current, handleUpdate)
  }, [suggestTitle, current, handleUpdate])

  const handleSuggestDescription = useCallback(() => {
    suggestDescription(current, handleUpdate)
  }, [suggestDescription, current, handleUpdate])

  if (!available) {
    return {
      titleSuggestProps: undefined,
      descriptionSuggestProps: undefined,
    }
  }

  // Title icon enabled when description OR content exists
  const titleEnabled = !!(current.description.trim() || current.content.trim())
  // Description icon enabled when content exists
  const descriptionEnabled = !!current.content.trim()

  return {
    titleSuggestProps: {
      onSuggest: handleSuggestTitle,
      isSuggesting: isSuggestingTitle,
      suggestDisabled: !titleEnabled,
      suggestTooltip: 'Add a description or content to enable AI title suggestion',
    },
    descriptionSuggestProps: {
      onSuggest: handleSuggestDescription,
      isSuggesting: isSuggestingDescription,
      suggestDisabled: !descriptionEnabled,
      suggestTooltip: 'Add content to enable AI description suggestion',
    },
  }
}
