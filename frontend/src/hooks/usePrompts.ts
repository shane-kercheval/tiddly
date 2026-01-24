/**
 * Hook for non-cacheable prompt utilities.
 *
 * These operations are not cached because:
 * - fetchPrompt: Used for edit view - always want fresh data
 * - trackPromptUsage: Fire-and-forget, no caching needed
 *
 * For cached prompt list queries, see usePromptsQuery.
 * For mutations with cache invalidation, see usePromptMutations.
 */
import { useCallback } from 'react'
import { api } from '../services/api'
import type { Prompt, PromptListItem, PromptRenderResponse } from '../types'

interface UsePromptsReturn {
  /** Fetch a single prompt by ID (with full content for viewing/editing) */
  fetchPrompt: (id: string) => Promise<Prompt>
  /** Fetch prompt metadata only (lightweight, for stale checking) */
  fetchPromptMetadataNoCache: (id: string) => Promise<PromptListItem>
  /** Track prompt usage (fire-and-forget) */
  trackPromptUsage: (id: string) => void
  /** Render a prompt with the given arguments */
  renderPrompt: (id: string, args: Record<string, unknown>) => Promise<string>
}

/**
 * Hook for non-cacheable prompt utilities.
 *
 * @example
 * ```tsx
 * const { fetchPrompt, fetchPromptMetadataNoCache, trackPromptUsage, renderPrompt } = usePrompts()
 *
 * // Fetch full prompt for viewing/editing
 * const prompt = await fetchPrompt(id)
 *
 * // Fetch lightweight metadata (for stale checking)
 * const metadata = await fetchPromptMetadataNoCache(id)
 *
 * // Track when user views a prompt
 * trackPromptUsage(id)
 *
 * // Render a prompt with arguments
 * const rendered = await renderPrompt(id, { name: 'World' })
 * ```
 */
export function usePrompts(): UsePromptsReturn {
  const fetchPrompt = useCallback(async (id: string): Promise<Prompt> => {
    const response = await api.get<Prompt>(`/prompts/${id}`)
    return response.data
  }, [])

  const fetchPromptMetadataNoCache = useCallback(async (id: string): Promise<PromptListItem> => {
    // Cache-bust to prevent Safari from returning stale cached responses
    const response = await api.get<PromptListItem>(`/prompts/${id}/metadata`, {
      params: { _t: Date.now() },
    })
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
    fetchPromptMetadataNoCache,
    trackPromptUsage,
    renderPrompt,
  }
}
