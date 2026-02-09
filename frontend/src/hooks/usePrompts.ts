/**
 * Hook for prompt fetch utilities.
 *
 * These operations bypass React Query caching because:
 * - fetchPrompt: Used for edit view - always want fresh data
 * - fetchPromptMetadata: Used for stale checking - always needs fresh data
 * - trackPromptUsage: Fire-and-forget, no caching needed
 *
 * For cached prompt list queries, see usePromptsQuery.
 * For mutations with cache invalidation, see usePromptMutations.
 */
import { useCallback } from 'react'
import { api } from '../services/api'
import type { Prompt, PromptListItem, PromptRenderResponse } from '../types'

/** Options for fetch operations */
interface FetchOptions {
  /**
   * Skip browser cache by adding a cache-bust parameter.
   * Use when you need guaranteed fresh data (e.g., after conflict detection).
   * Required for Safari which aggressively caches despite Cache-Control headers.
   */
  skipCache?: boolean
}

interface UsePromptsReturn {
  /** Fetch a single prompt by ID (with full content for viewing/editing) */
  fetchPrompt: (id: string, options?: FetchOptions) => Promise<Prompt>
  /** Fetch prompt metadata only (lightweight, for stale checking). Defaults to skipCache: true */
  fetchPromptMetadata: (id: string, options?: FetchOptions) => Promise<PromptListItem>
  /** Track prompt usage (fire-and-forget) */
  trackPromptUsage: (id: string) => void
  /** Render a prompt with the given arguments */
  renderPrompt: (id: string, args: Record<string, unknown>) => Promise<string>
}

/**
 * Hook for prompt fetch utilities.
 *
 * @example
 * ```tsx
 * const { fetchPrompt, fetchPromptMetadata, trackPromptUsage, renderPrompt } = usePrompts()
 *
 * // Fetch full prompt for viewing/editing (allows cache)
 * const prompt = await fetchPrompt(id)
 *
 * // Fetch full prompt, bypassing cache (e.g., after conflict)
 * const fresh = await fetchPrompt(id, { skipCache: true })
 *
 * // Fetch lightweight metadata for stale checking (skips cache by default)
 * const metadata = await fetchPromptMetadata(id)
 *
 * // Track when user views a prompt
 * trackPromptUsage(id)
 *
 * // Render a prompt with arguments
 * const rendered = await renderPrompt(id, { name: 'World' })
 * ```
 */
export function usePrompts(): UsePromptsReturn {
  const fetchPrompt = useCallback(async (
    id: string,
    options?: FetchOptions
  ): Promise<Prompt> => {
    // Cache-bust param forces Safari to fetch fresh data instead of returning stale cache
    const params = options?.skipCache ? { _t: Date.now() } : undefined
    const response = await api.get<Prompt>(`/prompts/${id}`, { params })
    return response.data
  }, [])

  const fetchPromptMetadata = useCallback(async (
    id: string,
    options: FetchOptions = { skipCache: true }
  ): Promise<PromptListItem> => {
    // Default to skipCache: true since this is primarily used for stale detection
    // where fresh data is always needed
    const params = options.skipCache ? { _t: Date.now() } : undefined
    const response = await api.get<PromptListItem>(`/prompts/${id}/metadata`, { params })
    return response.data
  }, [])

  const trackPromptUsage = useCallback((id: string): void => {
    // Fire-and-forget: no await, no error handling
    // This is non-critical tracking that shouldn't block user navigation
    api.post(`/prompts/${id}/track-usage`).catch(() => {
      // Silently ignore errors
    })
  }, [])

  const renderPrompt = useCallback(async (id: string, args: Record<string, unknown>): Promise<string> => {
    const response = await api.post<PromptRenderResponse>(
      `/prompts/${id}/render`,
      { arguments: args },
    )
    return response.data.rendered_content
  }, [])

  return {
    fetchPrompt,
    fetchPromptMetadata,
    trackPromptUsage,
    renderPrompt,
  }
}
