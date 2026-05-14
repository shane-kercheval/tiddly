/**
 * Hook for fetching AI metadata (name/title/description) suggestions.
 *
 * Manages the fields parameter logic per sparkle click:
 * - Click any sparkle → request whichever fields are currently empty.
 *   (Existing pattern: clicking title when description is empty also
 *   generates description; same idea applies to name.)
 *
 * No caching — metadata suggestions replace content, so each click should
 * produce a fresh result.
 */
import { useState, useCallback, useRef } from 'react'
import { suggestMetadata } from '../services/aiApi'
import { toastAiSuggestionError } from './aiErrorToast'

type MetadataField = 'name' | 'title' | 'description'

interface MetadataContext {
  /** Prompt name/slug. Optional — bookmarks and notes don't have one. */
  name?: string
  title: string
  url?: string
  description: string
  content: string
}

type SuggestUpdate = (
  name: string | null,
  title: string | null,
  description: string | null,
) => void

interface UseMetadataSuggestionsOptions {
  /** Whether AI is available for this user's tier. When false, all handlers are no-ops. */
  available?: boolean
}

interface UseMetadataSuggestionsReturn {
  /** Whether a name suggestion is currently in flight (including multi-field requests that include name). */
  isSuggestingName: boolean
  /** Whether a title suggestion is currently in flight (including multi-field requests). */
  isSuggestingTitle: boolean
  /** Whether a description suggestion is currently in flight (including multi-field requests). */
  isSuggestingDescription: boolean
  /** Request a name suggestion. Also fills empty title/description when those are blank. */
  suggestName: (context: MetadataContext, onUpdate: SuggestUpdate) => void
  /** Request a title suggestion. Also fills description if empty. */
  suggestTitle: (context: MetadataContext, onUpdate: SuggestUpdate) => void
  /** Request a description suggestion. Also fills title if empty. */
  suggestDescription: (context: MetadataContext, onUpdate: SuggestUpdate) => void
}

export function useMetadataSuggestions(
  { available = true }: UseMetadataSuggestionsOptions = {},
): UseMetadataSuggestionsReturn {
  // Tracks which fields are being generated so each sparkle button can bind
  // to the right spinner. A single `isLoading` boolean would cause all
  // spinners to show on any click (buttons share the hook instance).
  const [inFlightFields, setInFlightFields] = useState<readonly MetadataField[] | null>(null)
  const requestIdRef = useRef(0)

  const suggest = useCallback((
    fields: MetadataField[],
    context: MetadataContext,
    onUpdate: SuggestUpdate,
  ) => {
    if (!available) return

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    setInFlightFields(fields)

    suggestMetadata({
      fields,
      url: context.url,
      name: context.name || null,
      title: context.title || null,
      description: context.description || null,
      content_snippet: context.content?.slice(0, 2000) || null,
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId) {
          onUpdate(response.name, response.title, response.description)
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch metadata suggestion:', error)
          toastAiSuggestionError(error, "Couldn't generate suggestion. Please try again.")
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setInFlightFields(null)
        }
      })
  }, [available])

  const suggestName = useCallback((
    context: MetadataContext,
    onUpdate: SuggestUpdate,
  ) => {
    const fields: MetadataField[] = ['name']
    if (!context.title.trim()) fields.push('title')
    if (!context.description.trim()) fields.push('description')
    suggest(fields, context, onUpdate)
  }, [suggest])

  // Note: `context.name` may be undefined for non-prompt callers; that's fine
  // since the request body sends `name: null` and only the Prompt component
  // wires up the suggest-name button.

  const suggestTitle = useCallback((
    context: MetadataContext,
    onUpdate: SuggestUpdate,
  ) => {
    const fields: MetadataField[] = context.description.trim()
      ? ['title']
      : ['title', 'description']
    suggest(fields, context, onUpdate)
  }, [suggest])

  const suggestDescription = useCallback((
    context: MetadataContext,
    onUpdate: SuggestUpdate,
  ) => {
    const fields: MetadataField[] = context.title.trim()
      ? ['description']
      : ['title', 'description']
    suggest(fields, context, onUpdate)
  }, [suggest])

  return {
    isSuggestingName: inFlightFields?.includes('name') ?? false,
    isSuggestingTitle: inFlightFields?.includes('title') ?? false,
    isSuggestingDescription: inFlightFields?.includes('description') ?? false,
    suggestName,
    suggestTitle,
    suggestDescription,
  }
}
