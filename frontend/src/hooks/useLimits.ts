/**
 * Hook for fetching and caching user tier limits.
 *
 * Limits are fetched from /users/me/limits and cached indefinitely
 * (staleTime: Infinity) since they rarely change. A page refresh
 * clears the cache and fetches fresh limits.
 *
 * The cache is scoped by user ID to prevent stale limits when switching
 * accounts without a full page reload.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { useAuthStatus } from './useAuthStatus'
import type { UserLimits } from '../types'

/**
 * Query key factory for user limits.
 * Scoped by user ID to handle account switching.
 */
export const limitsKeys = {
  all: ['user-limits'] as const,
  user: (userId: string) => [...limitsKeys.all, userId] as const,
}

/**
 * Fetch user limits from API.
 */
async function fetchLimits(): Promise<UserLimits> {
  const response = await api.get<UserLimits>('/users/me/limits')
  return response.data
}

/**
 * Hook for fetching user tier limits with caching.
 *
 * @returns Query result with limits data, loading state, and error
 *
 * @example
 * ```tsx
 * const { limits, isLoading, error } = useLimits()
 *
 * if (error) {
 *   return <ErrorBanner message="Failed to load limits" />
 * }
 * if (isLoading || !limits) {
 *   return <LoadingSpinner />
 * }
 *
 * return <Input maxLength={limits.max_title_length} />
 * ```
 */
export function useLimits(): {
  limits: UserLimits | undefined
  isLoading: boolean
  error: Error | null
} {
  const { isAuthenticated, userId } = useAuthStatus()

  const { data, isLoading, error } = useQuery({
    queryKey: limitsKeys.user(userId ?? 'anonymous'),
    queryFn: fetchLimits,
    enabled: isAuthenticated && !!userId, // Only fetch when authenticated
    staleTime: Infinity, // Limits rarely change, cache until page refresh
    gcTime: Infinity, // Keep in cache indefinitely
  })

  return {
    limits: data,
    isLoading,
    error: error as Error | null,
  }
}
