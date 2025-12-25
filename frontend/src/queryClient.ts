import { QueryClient } from '@tanstack/react-query'

/**
 * TanStack Query client with application-wide defaults.
 *
 * Configuration:
 * - staleTime: 5 minutes - data considered fresh, won't refetch
 * - gcTime: 10 minutes - keep unused data in cache
 * - retry: 1 - single retry on failure
 * - refetchOnWindowFocus: 'always' - always refetch on focus for multi-tab sync
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,        // 5 minutes
      gcTime: 1000 * 60 * 10,          // 10 minutes
      retry: 1,
      refetchOnWindowFocus: 'always',  // Always refetch for multi-tab sync
    },
  },
})

/**
 * Create a fresh QueryClient for testing.
 * Disables retries to make tests faster and more predictable.
 */
export const createTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
