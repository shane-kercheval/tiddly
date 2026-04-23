/**
 * Shared toast helper for user-initiated AI suggestion failures (sparkle
 * clicks). Dropdown-based auto-loaded suggestions (tags, relationships)
 * don't use this — they surface errors inline in the dropdown itself
 * rather than via a toast the user didn't ask for.
 */
import toast from 'react-hot-toast'
import { AxiosError } from 'axios'
import { GLOBALLY_TOASTED_STATUSES } from '../services/api'

interface AiErrorPayload {
  error_code?: string
  detail?: string
}

/**
 * Show a toast describing an AI suggestion failure. Tailors the message
 * to the `error_code` in the backend response (e.g. `llm_timeout`).
 *
 * Statuses in `GLOBALLY_TOASTED_STATUSES` (quota, rate limit) are already
 * toasted by the axios response interceptor in `services/api.tsx`; we
 * short-circuit for those to avoid double-toasting the same failure.
 * If the interceptor's status-code handling ever changes, update the
 * exported list there rather than hand-editing callers.
 */
export function toastAiSuggestionError(error: unknown, fallback: string): void {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    if (status !== undefined && (GLOBALLY_TOASTED_STATUSES as readonly number[]).includes(status)) {
      return
    }
    const payload = error.response?.data as AiErrorPayload | undefined
    if (payload?.error_code === 'llm_timeout') {
      toast.error('The AI service took too long to respond. Please try again.')
      return
    }
  }

  toast.error(fallback)
}
