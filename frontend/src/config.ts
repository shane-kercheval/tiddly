/**
 * Application configuration loaded from environment variables.
 */

export const config = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  auth0: {
    domain: import.meta.env.VITE_AUTH0_DOMAIN || '',
    clientId: import.meta.env.VITE_AUTH0_CLIENT_ID || '',
    audience: import.meta.env.VITE_AUTH0_AUDIENCE || '',
  },
} as const

/**
 * Dev mode is determined by the absence of Auth0 configuration.
 * When Auth0 is not configured, the app runs without authentication.
 * The backend must also have DEV_MODE=true for this to work.
 */
export const isDevMode = !config.auth0.domain
