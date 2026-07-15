/**
 * Application configuration loaded from environment variables.
 *
 * Note: Field length limits are now fetched from the API via useLimits() hook.
 * See /users/me/limits endpoint and hooks/useLimits.ts
 */

export const config = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  mcpUrl: import.meta.env.VITE_MCP_URL || 'http://localhost:8001',
  promptMcpUrl: import.meta.env.VITE_PROMPT_MCP_URL || 'http://localhost:8002',
  clerk: {
    publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '',
  },
} as const

/**
 * Dev mode can be enabled by:
 * 1. Setting VITE_DEV_MODE=true, OR
 * 2. Leaving VITE_CLERK_PUBLISHABLE_KEY empty
 *
 * When in dev mode, the app runs without authentication.
 * The backend must also have DEV_MODE=true for this to work.
 */
export const isDevMode =
  import.meta.env.VITE_DEV_MODE === 'true' || !config.clerk.publishableKey
