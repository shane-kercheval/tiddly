/**
 * Hook for fetching AI relationship suggestions.
 *
 * Fires a suggestion request when opened, discards stale responses on close/unmount.
 * Caches the last response per content fingerprint — reopening the same item
 * without content changes reuses cached suggestions (minus any promoted candidates).
 */
import { useState, useCallback, useRef } from 'react'
import { suggestRelationships } from '../services/aiApi'
import type { RelationshipCandidate } from '../types'

interface RelationshipSuggestionContext {
  sourceId?: string | null
  title?: string | null
  url?: string | null
  description?: string | null
  content?: string | null
  currentTags: string[]
  existingRelationshipIds: string[]
}

interface UseRelationshipSuggestionsOptions {
  /** Whether AI is available for this user's tier. When false, fetchSuggestions is a no-op. Defaults to true. */
  available?: boolean
}

interface UseRelationshipSuggestionsReturn {
  /** AI-suggested relationship candidates (empty until loaded). */
  suggestions: RelationshipCandidate[]
  /** Whether a suggestion request is in flight. */
  isLoading: boolean
  /** True if the last fetch attempt failed. Cleared on the next fetch. */
  hasError: boolean
  /** Fetch suggestions. Call when linked content input opens. No-op if unavailable or context is blank. */
  fetchSuggestions: (context: RelationshipSuggestionContext) => void
  /** Clear suggestions (but preserve cache). Call when linked content input closes. */
  clearSuggestions: () => void
  /** Remove a single suggestion (after user promotes it). */
  dismissSuggestion: (entityId: string) => void
}

/** Relationships require title or tags — description/content alone aren't sufficient for search. */
function hasContext(ctx: RelationshipSuggestionContext): boolean {
  return !!(ctx.title?.trim() || ctx.currentTags.length > 0)
}

/**
 * Cache key from content fields only (not existingRelationshipIds or currentTags).
 * Promoting a suggestion changes existingRelationshipIds but the cached
 * suggestions (minus the promoted one) are still valid.
 */
function buildCacheKey(ctx: RelationshipSuggestionContext): string {
  return JSON.stringify({
    sourceId: ctx.sourceId,
    title: ctx.title,
    url: ctx.url,
    description: ctx.description,
    content_snippet: ctx.content?.slice(0, 2000),
    // Tags are included because the backend searches by tags — different tags = different candidates.
    // This differs from tag suggestions where currentTags don't affect what the LLM suggests.
    tags: [...ctx.currentTags].sort(),
  })
}

export function useRelationshipSuggestions(
  { available = true }: UseRelationshipSuggestionsOptions = {},
): UseRelationshipSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<RelationshipCandidate[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const requestIdRef = useRef(0)
  const cacheRef = useRef<{ key: string; suggestions: RelationshipCandidate[] } | null>(null)

  const clearSuggestions = useCallback(() => {
    requestIdRef.current += 1
    setSuggestions([])
    setIsLoading(false)
    setHasError(false)
  }, [])

  const fetchSuggestions = useCallback((context: RelationshipSuggestionContext) => {
    if (!available || !hasContext(context)) {
      return
    }

    const cacheKey = buildCacheKey(context)
    if (cacheRef.current?.key === cacheKey) {
      setSuggestions(cacheRef.current.suggestions)
      setHasError(false)
      return
    }

    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    setIsLoading(true)
    setHasError(false)
    setSuggestions([])

    suggestRelationships({
      source_id: context.sourceId,
      title: context.title,
      url: context.url,
      description: context.description,
      content_snippet: context.content?.slice(0, 2000),
      current_tags: context.currentTags,
      existing_relationship_ids: context.existingRelationshipIds,
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId) {
          setSuggestions(response.candidates)
          cacheRef.current = { key: cacheKey, suggestions: response.candidates }
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch relationship suggestions:', error)
          setHasError(true)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setIsLoading(false)
        }
      })
  }, [available])

  const dismissSuggestion = useCallback((entityId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.entity_id !== entityId))
    if (cacheRef.current) {
      cacheRef.current = {
        ...cacheRef.current,
        suggestions: cacheRef.current.suggestions.filter((s) => s.entity_id !== entityId),
      }
    }
  }, [])

  return {
    suggestions,
    isLoading,
    hasError,
    fetchSuggestions,
    clearSuggestions,
    dismissSuggestion,
  }
}
