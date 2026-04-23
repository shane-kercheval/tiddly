/**
 * Shared AI tag suggestion integration for detail components.
 *
 * Composes useTagSuggestions and returns ready-to-use handlers for
 * InlineEditableTags props (onOpen, onClose, onChange, aiSuggestions).
 *
 * The caller passes `available` (from useAIAvailability) so this hook
 * doesn't depend on React Query directly — keeping it safe for component
 * tests that render without a QueryClientProvider.
 *
 * Used by Bookmark, Note, and Prompt detail components.
 */
import { useCallback } from 'react'
import { useTagSuggestions } from './useTagSuggestions'

/** Minimum state shape required — detail components have additional fields. */
interface TaggableState {
  title: string
  description: string
  content: string
  tags: string[]
  url?: string
}

interface UseAITagIntegrationReturn {
  aiTagSuggestions: string[]
  isAiTagsLoading: boolean
  aiTagsHasError: boolean
  handleTagInputOpen: () => void
  handleTagInputClose: () => void
  handleTagsChange: (tags: string[]) => void
}

export function useAITagIntegration<T extends TaggableState>(
  current: T,
  setCurrent: React.Dispatch<React.SetStateAction<T>>,
  available: boolean = false,
  contentType: 'bookmark' | 'note' | 'prompt' = 'bookmark',
): UseAITagIntegrationReturn {
  const { suggestions: aiTagSuggestions, isLoading: isAiTagsLoading, hasError: aiTagsHasError, fetchSuggestions, clearSuggestions, dismissSuggestion } =
    useTagSuggestions({ available })

  const handleTagInputOpen = useCallback(() => {
    fetchSuggestions({
      title: current.title,
      url: current.url,
      description: current.description,
      content: current.content,
      contentType,
      currentTags: current.tags,
    })
  }, [fetchSuggestions, current.title, current.url, current.description, current.content, current.tags, contentType])

  const handleTagInputClose = useCallback(() => {
    clearSuggestions()
  }, [clearSuggestions])

  const handleTagsChange = useCallback((tags: string[]) => {
    const newTag = tags.find((t) => !current.tags.includes(t))
    if (newTag) dismissSuggestion(newTag)
    setCurrent((prev) => ({ ...prev, tags }))
  }, [current.tags, dismissSuggestion, setCurrent])

  return {
    aiTagSuggestions,
    isAiTagsLoading,
    aiTagsHasError,
    handleTagInputOpen,
    handleTagInputClose,
    handleTagsChange,
  }
}
