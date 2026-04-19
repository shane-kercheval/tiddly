/**
 * Add tag action button for ContentCard.
 *
 * Wraps the AddTagButton component with optional AI tag suggestions.
 * When aiContext is provided and AI is available, fetches suggestions
 * when the dropdown opens.
 */
import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { AddTagButton } from '../../AddTagButton'
import { useTagSuggestions } from '../../../hooks/useTagSuggestions'
import { useAIAvailability } from '../../../hooks/useAIAvailability'
import type { TagCount } from '../../../types'

interface AddTagActionProps {
  /** Tags already on this item (excluded from suggestions) */
  existingTags: string[]
  /** Available tags for autocomplete suggestions */
  suggestions: TagCount[]
  /** Called when a tag is added */
  onAdd: (tag: string) => void
  /** Item context for AI tag suggestions. Omit to disable AI suggestions. */
  aiContext?: {
    title?: string | null
    url?: string | null
    description?: string | null
    content?: string | null
    contentType: 'bookmark' | 'note' | 'prompt'
  }
}

export function AddTagAction({ existingTags, suggestions, onAdd, aiContext }: AddTagActionProps): ReactNode {
  const { available: aiAvailable } = useAIAvailability()
  const { suggestions: aiSuggestions, isLoading: isAiLoading, hasError: aiHasError, fetchSuggestions, clearSuggestions, dismissSuggestion } = useTagSuggestions({ available: aiAvailable })

  const handleOpen = useCallback(() => {
    if (aiContext) {
      fetchSuggestions({
        ...aiContext,
        currentTags: existingTags,
      })
    }
  }, [aiContext, existingTags, fetchSuggestions])

  const handleClose = useCallback(() => {
    clearSuggestions()
  }, [clearSuggestions])

  const handleAdd = useCallback((tag: string) => {
    dismissSuggestion(tag)
    onAdd(tag)
  }, [onAdd, dismissSuggestion])

  return (
    <AddTagButton
      existingTags={existingTags}
      suggestions={suggestions}
      onAdd={handleAdd}
      aiSuggestions={aiSuggestions}
      isAiLoading={isAiLoading}
      aiHasError={aiHasError}
      aiAvailable={aiAvailable}
      onOpen={handleOpen}
      onClose={handleClose}
    />
  )
}
