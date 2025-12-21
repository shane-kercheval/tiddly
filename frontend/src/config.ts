/**
 * Application configuration loaded from environment variables.
 */

export const config = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  mcpUrl: import.meta.env.VITE_MCP_URL || 'http://localhost:8001',
  auth0: {
    domain: import.meta.env.VITE_AUTH0_DOMAIN || '',
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID || '',
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || '',
  },
} as const

/**
 * Dev mode can be enabled by:
 * 1. Setting VITE_DEV_MODE=true, OR
 * 2. Leaving VITE_AUTH0_DOMAIN empty
 *
 * When in dev mode, the app runs without authentication.
 * The backend must also have DEV_MODE=true for this to work.
 */
export const isDevMode = import.meta.env.VITE_DEV_MODE === 'true' || !config.auth0.domain

/**
 * Policy version tracking for consent management.
 *
 * When you update PRIVACY.md or TERMS.md:
 * 1. Update the "Last Updated" date in the policy file
 * 2. Update the corresponding version constant below
 * 3. Deploy changes
 *
 * Result: All users will see consent dialog again on next login (version mismatch).
 */
export const PRIVACY_POLICY_VERSION = '2024-12-20'
export const TERMS_OF_SERVICE_VERSION = '2024-12-20'
