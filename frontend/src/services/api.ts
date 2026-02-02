import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import toast from 'react-hot-toast'
import { config, isDevMode } from '../config'
import { useConsentStore } from '../stores/consentStore'

/**
 * Axios instance configured with the API base URL.
 * Auth interceptors are set up separately via setupAuthInterceptor.
 */
export const api = axios.create({
  baseURL: config.apiUrl,
})

let isLoggingOut = false
let refreshPromise: Promise<string> | null = null

/**
 * Token getter function type - provided by Auth0 context.
 */
type GetAccessTokenFn = (options?: { cacheMode?: 'on' | 'off' | 'cache-only' }) => Promise<string>

/**
 * Auth error handler function type - called when 401 is received.
 */
type OnAuthErrorFn = () => void

/**
 * Consent API types
 */
export interface ConsentResponse {
  id: string
  user_id: string
  consented_at: string
  privacy_policy_version: string
  terms_of_service_version: string
  ip_address: string | null
  user_agent: string | null
}

export interface ConsentCreate {
  privacy_policy_version: string
  terms_of_service_version: string
}

export interface ConsentStatus {
  needs_consent: boolean
  current_consent: ConsentResponse | null
  current_privacy_version: string
  current_terms_version: string
}

export interface PolicyVersions {
  privacy_policy_version: string
  terms_of_service_version: string
}

/**
 * Sets up auth interceptors on the API instance.
 * Should be called once when the Auth0 context is available.
 *
 * 401 Retry Strategy:
 * When a request fails with 401, we retry once with `cacheMode: 'off'` to force
 * a fresh token fetch (using the refresh token) instead of returning a cached
 * expired access token. This handles the case where the access token expired
 * but the refresh token is still valid. Only if the retry also fails do we
 * trigger logout.
 *
 * The shared `refreshPromise` prevents multiple concurrent requests from each
 * triggering their own token refresh - they all await the same refresh operation.
 * This avoids race conditions with refresh token rotation.
 *
 * Logging prefixed with [Auth] helps debug token expiration issues in production.
 * Enable "Preserve log" in browser DevTools to capture logs across redirects.
 *
 * @param getAccessToken - Function to get the current access token (must accept options)
 * @param onAuthError - Function to call when authentication fails (e.g., logout)
 */
export function setupAuthInterceptor(
  getAccessToken: GetAccessTokenFn,
  onAuthError: OnAuthErrorFn
): void {
  isLoggingOut = false
  refreshPromise = null

  // Request interceptor - add auth token (production only)
  api.interceptors.request.use(
    async (requestConfig: InternalAxiosRequestConfig) => {
      if (!isDevMode) {
        try {
          const token = await getAccessToken()
          requestConfig.headers.Authorization = `Bearer ${token}`
        } catch (error) {
          // Token fetch failed - log for debugging, then let request proceed
          // The 401 response interceptor will handle retry with cache bypass
          console.error('[Auth] Initial token fetch failed:', {
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : 'unknown',
            url: requestConfig.url,
            timestamp: new Date().toISOString(),
          })
        }
      }
      return requestConfig
    },
    (error: AxiosError) => Promise.reject(error)
  )

  // Response interceptor - handle auth, consent, and rate limit errors
  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (error.response?.status === 401 && !isDevMode) {
        const requestConfig = error.config as (InternalAxiosRequestConfig & { _retryAuth?: boolean }) | undefined

        if (requestConfig && !requestConfig._retryAuth) {
          requestConfig._retryAuth = true
          try {
            if (!refreshPromise) {
              refreshPromise = getAccessToken({ cacheMode: 'off' }).finally(() => {
                refreshPromise = null
              })
            }
            const token = await refreshPromise
            requestConfig.headers = requestConfig.headers ?? {}
            requestConfig.headers.Authorization = `Bearer ${token}`
            return api.request(requestConfig)
          } catch (error) {
            // Token refresh failed - log for debugging before triggering logout
            console.error('[Auth] Token refresh failed, logging out:', {
              error: error instanceof Error ? error.message : String(error),
              errorName: error instanceof Error ? error.name : 'unknown',
              url: requestConfig.url,
              timestamp: new Date().toISOString(),
            })
            // Fall through to logout handling below
          }
        }

        // Token expired or invalid - trigger logout/re-login
        if (!isLoggingOut) {
          isLoggingOut = true
          onAuthError()
        }
      }
      if (error.response?.status === 402) {
        // Quota exceeded - show resource-specific message
        const data = error.response.data as { resource?: string; limit?: number; error_code?: string }
        if (data?.error_code === 'QUOTA_EXCEEDED') {
          const resource = data.resource ?? 'items'
          const limit = data.limit ?? 0
          toast.error(
            `You've reached the limit of ${limit.toLocaleString()} ${resource}. Delete some existing items to create new ones.`,
            { id: 'quota-exceeded' }
          )
        }
      }
      if (error.response?.status === 429) {
        // Rate limit exceeded - show user-friendly message
        const retryAfter = error.response.headers['retry-after']
        const message = retryAfter
          ? `Too many requests. Please wait ${retryAfter} seconds.`
          : 'Too many requests. Please try again later.'
        toast.error(message, { id: 'rate-limit' }) // id prevents duplicate toasts
      }
      if (error.response?.status === 451) {
        // Consent required - show dialog immediately and fetch new versions
        useConsentStore.getState().handleConsentRequired()
      }
      return Promise.reject(error)
    }
  )
}

/**
 * Consent API Methods
 */

/**
 * Check if user needs to consent.
 * This is the recommended endpoint - never returns 404.
 *
 * Returns:
 * - needs_consent: true if user needs to accept/re-accept terms
 * - current_consent: existing consent record (if any)
 */
export async function checkConsentStatus(): Promise<ConsentStatus> {
  const response = await api.get<ConsentStatus>('/consent/status')
  return response.data
}

/**
 * Record or update the current user's consent.
 * Creates a new consent record if none exists, or updates the existing one.
 */
export async function recordMyConsent(
  data: ConsentCreate
): Promise<ConsentResponse> {
  const response = await api.post<ConsentResponse>('/consent/me', data)
  return response.data
}

/**
 * Get current policy versions (public endpoint, no auth required).
 * Used by public pages to display version dates.
 */
export async function getPolicyVersions(): Promise<PolicyVersions> {
  // Use axios directly instead of api instance to avoid auth interceptors
  const response = await axios.get<PolicyVersions>(`${config.apiUrl}/consent/versions`)
  return response.data
}
