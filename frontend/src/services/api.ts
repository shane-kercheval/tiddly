import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { config, isDevMode } from '../config'

/**
 * Axios instance configured with the API base URL.
 * Auth interceptors are set up separately via setupAuthInterceptor.
 */
export const api = axios.create({
  baseURL: config.apiUrl,
})

/**
 * Token getter function type - provided by Auth0 context.
 */
type GetAccessTokenFn = () => Promise<string>

/**
 * Auth error handler function type - called when 401 is received.
 */
type OnAuthErrorFn = () => void

/**
 * Sets up auth interceptors on the API instance.
 * Should be called once when the Auth0 context is available.
 *
 * @param getAccessToken - Function to get the current access token
 * @param onAuthError - Function to call when authentication fails (e.g., logout)
 */
export function setupAuthInterceptor(
  getAccessToken: GetAccessTokenFn,
  onAuthError: OnAuthErrorFn
): void {
  // Request interceptor - add auth token (production only)
  api.interceptors.request.use(
    async (requestConfig: InternalAxiosRequestConfig) => {
      if (!isDevMode) {
        try {
          const token = await getAccessToken()
          requestConfig.headers.Authorization = `Bearer ${token}`
        } catch {
          // Token fetch failed - let the request proceed without auth
          // The 401 response interceptor will handle it
        }
      }
      return requestConfig
    },
    (error: AxiosError) => Promise.reject(error)
  )

  // Response interceptor - handle auth errors
  api.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 401 && !isDevMode) {
        // Token expired or invalid - trigger logout/re-login
        onAuthError()
      }
      return Promise.reject(error)
    }
  )
}
