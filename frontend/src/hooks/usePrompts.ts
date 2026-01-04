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
import type { Prompt } from '../types'

interface UsePromptsReturn {
  /** Fetch a single prompt by ID (with full content for viewing/editing) */
  fetchPrompt: (id: number) => Promise<Prompt>
  /** Track prompt usage (fire-and-forget) */
  trackPromptUsage: (id: number) => void
}

/**
 * Hook for non-cacheable prompt utilities.
 *
 * @example
 * ```tsx
 * const { fetchPrompt, trackPromptUsage } = usePrompts()
 *
 * // Fetch full prompt for viewing/editing
 * const prompt = await fetchPrompt(id)
 *
 * // Track when user views a prompt
 * trackPromptUsage(id)
 * ```
 */
export function usePrompts(): UsePromptsReturn {
  const fetchPrompt = useCallback(async (id: number): Promise<Prompt> => {
    const response = await api.get<Prompt>(`/prompts/${id}`)
    return response.data
  }, [])

  const trackPromptUsage = useCallback((id: number): void => {
    // Fire-and-forget: no await, no error handling
    // This is non-critical tracking that shouldn't block user navigation
    api.post(`/prompts/${id}/track-usage`).catch(() => {
      // Silently ignore errors
    })
  }, [])

  return {
    fetchPrompt,
    trackPromptUsage,
  }
}
