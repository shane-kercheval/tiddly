/**
 * Hook for quick-creating a new entity pre-linked to the current entity.
 *
 * Navigates to the "new" page for the target content type, passing:
 * - returnTo: current URL (so Close navigates back to source entity)
 * - initialRelationships: pre-populated relationship payload
 * - initialLinkedItems: display cache for the pre-populated link
 */
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ContentType } from '../types'

interface UseQuickCreateLinkedParams {
  contentType: ContentType
  contentId: string | null
  contentTitle: string | null
  contentUrl?: string | null
  contentPromptName?: string | null
}

const ROUTE_MAP: Record<ContentType, string> = {
  bookmark: '/app/bookmarks/new',
  note: '/app/notes/new',
  prompt: '/app/prompts/new',
}

/**
 * Returns a callback to navigate to a new entity page with a pre-populated link,
 * or undefined if the source entity is unsaved (contentId is null).
 */
export function useQuickCreateLinked({
  contentType,
  contentId,
  contentTitle,
  contentUrl,
  contentPromptName,
}: UseQuickCreateLinkedParams): ((targetType: ContentType) => void) | undefined {
  const navigate = useNavigate()
  const location = useLocation()

  const handleQuickCreate = useCallback((targetType: ContentType): void => {
    if (!contentId) return

    const returnTo = location.pathname + location.search

    navigate(ROUTE_MAP[targetType], {
      state: {
        returnTo,
        initialRelationships: [{
          target_type: contentType,
          target_id: contentId,
          relationship_type: 'related' as const,
        }],
        initialLinkedItems: [{
          relationshipId: '',
          type: contentType,
          id: contentId,
          title: contentTitle,
          url: contentUrl ?? null,
          promptName: contentPromptName ?? null,
          deleted: false,
          archived: false,
          description: null,
        }],
      },
    })
  }, [contentId, contentType, contentTitle, contentUrl, contentPromptName, navigate, location.pathname, location.search])

  if (!contentId) return undefined

  return handleQuickCreate
}
