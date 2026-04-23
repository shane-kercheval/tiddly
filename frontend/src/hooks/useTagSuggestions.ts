/**
 * Hook for fetching AI tag suggestions.
 *
 * Fires a suggestion request when opened, discards stale responses on close/unmount.
 * Caches the last response per content fingerprint — reopening the same item
 * without content changes reuses cached suggestions (minus any promoted tags).
 */
import { useState, useCallback, useRef } from 'react'
import { suggestTags } from '../services/aiApi'

interface TagSuggestionContext {
  title?: string | null
  url?: string | null
  description?: string | null
  content?: string | null
  contentType: 'bookmark' | 'note' | 'prompt'
  currentTags: string[]
}

interface UseTagSuggestionsOptions {
  /** Whether AI is available for this user's tier. When false, fetchSuggestions is a no-op. Defaults to true. */
  available?: boolean
}

interface UseTagSuggestionsReturn {
  /** AI-suggested tags (empty until loaded). */
  suggestions: string[]
  /** Whether a suggestion request is in flight. */
  isLoading: boolean
  /** True if the last fetch attempt failed. Cleared on the next fetch. */
  hasError: boolean
  /** Fetch suggestions. Call when tag input opens. No-op if unavailable or context is blank. */
  fetchSuggestions: (context: TagSuggestionContext) => void
  /** Clear suggestions (but preserve cache). Call when tag input closes. */
  clearSuggestions: () => void
  /** Remove a single suggestion (after user promotes it to a real tag). */
  dismissSuggestion: (tag: string) => void
}

/** Check if there's enough context to make a useful suggestion request. */
function hasContext(ctx: TagSuggestionContext): boolean {
  return !!(ctx.title?.trim() || ctx.url?.trim() || ctx.description?.trim() || ctx.content?.trim())
}

/**
 * Build a cache key from content fields only (not currentTags).
 * currentTags is excluded because promoting a suggestion changes currentTags
 * but the cached suggestions (minus the promoted one) are still valid.
 */
function buildCacheKey(ctx: TagSuggestionContext): string {
  return JSON.stringify({
    title: ctx.title,
    url: ctx.url,
    description: ctx.description,
    content_snippet: ctx.content?.slice(0, 2000),
    content_type: ctx.contentType,
  })
}

export function useTagSuggestions({ available = true }: UseTagSuggestionsOptions = {}): UseTagSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  // Monotonically increasing request ID — each fetch gets its own ID.
  // Stale responses (where the captured ID doesn't match current) are discarded.
  const requestIdRef = useRef(0)
  const cacheRef = useRef<{ key: string; suggestions: string[] } | null>(null)

  const clearSuggestions = useCallback(() => {
    // Increment to invalidate any in-flight request
    requestIdRef.current += 1
    setSuggestions([])
    setIsLoading(false)
    setHasError(false)
  }, [])

  const fetchSuggestions = useCallback((context: TagSuggestionContext) => {
    if (!available || !hasContext(context)) {
      return
    }

    // Check cache — reuse if content hasn't changed
    const cacheKey = buildCacheKey(context)
    if (cacheRef.current?.key === cacheKey) {
      setSuggestions(cacheRef.current.suggestions)
      setHasError(false)
      return
    }

    // Increment request ID — any in-flight request with an older ID will be discarded
    requestIdRef.current += 1
    const thisRequestId = requestIdRef.current

    setIsLoading(true)
    setHasError(false)
    setSuggestions([])

    suggestTags({
      title: context.title,
      url: context.url,
      description: context.description,
      content_snippet: context.content?.slice(0, 2000),
      content_type: context.contentType,
      current_tags: context.currentTags,
    })
      .then((response) => {
        if (requestIdRef.current === thisRequestId) {
          setSuggestions(response.tags)
          cacheRef.current = { key: cacheKey, suggestions: response.tags }
        }
      })
      .catch((error) => {
        if (requestIdRef.current === thisRequestId) {
          console.error('Failed to fetch tag suggestions:', error)
          setHasError(true)
        }
      })
      .finally(() => {
        if (requestIdRef.current === thisRequestId) {
          setIsLoading(false)
        }
      })
  }, [available])

  const dismissSuggestion = useCallback((tag: string) => {
    setSuggestions((prev) => prev.filter((s) => s !== tag))
    // Keep cache in sync so reopen doesn't resurrect dismissed tags
    if (cacheRef.current) {
      cacheRef.current = {
        ...cacheRef.current,
        suggestions: cacheRef.current.suggestions.filter((s) => s !== tag),
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
