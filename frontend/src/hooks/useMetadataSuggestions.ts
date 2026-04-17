/**
 * Hook for fetching AI metadata (title/description) suggestions.
 *
 * Manages the fields parameter logic:
 * - Title icon + no description → generate both
 * - Title icon + description exists → generate title only
 * - Description icon + no title → generate both
 * - Description icon + title exists → generate description only
 *
 * No caching — metadata suggestions replace content, so each click should
 * produce a fresh result.
 */
import { useState, useCallback, useRef } from 'react'
import { suggestMetadata } from '../services/aiApi'

interface MetadataContext {
  title: string
  url?: string
  description: string
  content: string
}

interface UseMetadataSuggestionsOptions {
  /** Whether AI is available for this user's tier. When false, all handlers are no-ops. */
  available?: boolean
}

interface UseMetadataSuggestionsReturn {
  /** Whether a suggestion request is in flight. */
  isLoading: boolean
  /** Request a title suggestion. Updates title (and description if empty) via onUpdate. */
  suggestTitle: (context: MetadataContext, onUpdate: (title: string | null, description: string | null) => void) => void
  /** Request a description suggestion. Updates description (and title if empty) via onUpdate. */
  suggestDescription: (context: MetadataContext, onUpdate: (title: string | null, description: string | null) => void) => void
}

export function useMetadataSuggestions(
  { available = true }: UseMetadataSuggestionsOptions = {},
): UseMetadataSuggestionsReturn {
  const [isLoading, setIsLoading] = useState(false)
  const requestIdRef = useRef(0)

  const suggest = useCallback((
    fields: ('title' | 'description')[],
    context: MetadataContext,
    onUpdate: (title: string | null, description: string | null) => void,
  ) => {
    if (!available) return

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    setIsLoading(true)

    suggestMetadata({
      fields,
      url: context.url,
      title: context.title || null,
      description: context.description || null,
      content_snippet: context.content?.slice(0, 2000) || null,
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId) {
          onUpdate(response.title, response.description)
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch metadata suggestion:', error)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setIsLoading(false)
        }
      })
  }, [available])

  const suggestTitle = useCallback((
    context: MetadataContext,
    onUpdate: (title: string | null, description: string | null) => void,
  ) => {
    const fields: ('title' | 'description')[] = context.description.trim()
      ? ['title']
      : ['title', 'description']
    suggest(fields, context, onUpdate)
  }, [suggest])

  const suggestDescription = useCallback((
    context: MetadataContext,
    onUpdate: (title: string | null, description: string | null) => void,
  ) => {
    const fields: ('title' | 'description')[] = context.title.trim()
      ? ['description']
      : ['title', 'description']
    suggest(fields, context, onUpdate)
  }, [suggest])

  return {
    isLoading,
    suggestTitle,
    suggestDescription,
  }
}
