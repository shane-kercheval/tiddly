/**
 * Hook for checking AI feature availability.
 *
 * Calls GET /ai/health and caches the result. Cache is invalidated after
 * each AI API call (not TTL-based) via aiApi.ts, so quota display stays current.
 *
 * This hook always checks platform quota (no BYOK header). BYOK quota is
 * fetched separately where needed (e.g. the settings page).
 */
import { useQuery } from '@tanstack/react-query'
import { fetchAIHealth } from '../services/aiApi'
import { useAuthStatus } from './useAuthStatus'

/**
 * Query key factory for AI health.
 * Exported so aiApi.ts can invalidate the cache after AI calls.
 */
export const aiHealthKeys = {
  all: ['ai-health'] as const,
  user: (userId: string) => [...aiHealthKeys.all, userId] as const,
}

/**
 * Hook for checking AI feature availability and remaining platform quota.
 *
 * @example
 * ```tsx
 * const { available, remainingPerDay, resetsAt, isLoading } = useAIAvailability()
 * if (!available) return null // hide AI features
 * ```
 */
export function useAIAvailability(): {
  available: boolean
  remainingPerDay: number
  limitPerDay: number
  /**
   * Absolute UTC time when the platform daily quota counter resets. `null`
   * when the user hasn't made any AI calls in the current window yet, or
   * when Redis is unavailable. Note: this is a snapshot at fetch time — the
   * hook uses `staleTime: Infinity` with manual invalidation, so long-lived
   * tabs should display the absolute time rather than a derived countdown.
   */
  resetsAt: Date | null
  isLoading: boolean
  error: Error | null
} {
  const { isAuthenticated, userId } = useAuthStatus()

  const { data, isLoading, error } = useQuery({
    queryKey: aiHealthKeys.user(userId ?? 'anonymous'),
    queryFn: () => fetchAIHealth(),
    enabled: isAuthenticated && !!userId,
    staleTime: Infinity, // Invalidated manually after each AI call
    gcTime: Infinity,
  })

  return {
    available: data?.available ?? false,
    remainingPerDay: data?.remaining_per_day ?? 0,
    limitPerDay: data?.limit_per_day ?? 0,
    // Explicit null-guard: `new Date(null)` returns Invalid Date, not null.
    resetsAt: data?.resets_at ? new Date(data.resets_at) : null,
    isLoading,
    error: error as Error | null,
  }
}
