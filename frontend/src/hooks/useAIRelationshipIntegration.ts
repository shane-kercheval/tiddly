/**
 * Shared AI relationship suggestion integration for detail components.
 *
 * Composes useRelationshipSuggestions and returns ready-to-use handlers
 * for LinkedContentChips props (onOpen, onClose, aiSuggestions).
 *
 * The caller passes `available` (from useAIAvailability) so this hook
 * doesn't depend on React Query directly.
 *
 * Used by Bookmark, Note, and Prompt detail components.
 */
import { useCallback } from 'react'
import { useRelationshipSuggestions } from './useRelationshipSuggestions'
import type { ContentListItem, RelationshipCandidate, RelationshipInputPayload } from '../types'

interface RelationshipContext {
  contentId: string | null
  title: string
  url?: string
  description: string
  content: string
  tags: string[]
  relationships: RelationshipInputPayload[]
}

interface UseAIRelationshipIntegrationReturn {
  aiRelationshipSuggestions: RelationshipCandidate[]
  isAiRelationshipsLoading: boolean
  handleLinkedContentOpen: () => void
  handleLinkedContentClose: () => void
  handleAddRelationshipWithDismiss: (item: ContentListItem, originalHandler: (item: ContentListItem) => void) => void
}

export function useAIRelationshipIntegration(
  current: RelationshipContext,
  available: boolean = false,
): UseAIRelationshipIntegrationReturn {
  const {
    suggestions: aiRelationshipSuggestions,
    isLoading: isAiRelationshipsLoading,
    fetchSuggestions,
    clearSuggestions,
    dismissSuggestion,
  } = useRelationshipSuggestions({ available })

  const handleLinkedContentOpen = useCallback(() => {
    fetchSuggestions({
      sourceId: current.contentId,
      title: current.title,
      url: current.url,
      description: current.description,
      content: current.content,
      currentTags: current.tags,
      existingRelationshipIds: current.relationships.map((r) => r.target_id),
    })
  }, [
    fetchSuggestions,
    current.contentId,
    current.title,
    current.url,
    current.description,
    current.content,
    current.tags,
    current.relationships,
  ])

  const handleLinkedContentClose = useCallback(() => {
    clearSuggestions()
  }, [clearSuggestions])

  const handleAddRelationshipWithDismiss = useCallback(
    (item: ContentListItem, originalHandler: (item: ContentListItem) => void) => {
      dismissSuggestion(item.id)
      originalHandler(item)
    },
    [dismissSuggestion],
  )

  return {
    aiRelationshipSuggestions,
    isAiRelationshipsLoading,
    handleLinkedContentOpen,
    handleLinkedContentClose,
    handleAddRelationshipWithDismiss,
  }
}
