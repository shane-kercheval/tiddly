/**
 * Zustand store for user consent management.
 * Manages consent state and checking with in-memory caching.
 *
 * NOTE: Uses in-memory cache only (no localStorage) to avoid stale consent
 * status after policy updates. One API call per session is acceptable performance.
 *
 * Version checking is handled server-side for consistency and maintainability.
 */
import { create } from 'zustand'
import type { ConsentResponse } from '../services/api'
import { checkConsentStatus, recordMyConsent } from '../services/api'
import { PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from '../config'

interface ConsentState {
  consent: ConsentResponse | null
  needsConsent: boolean | null  // null = not checked yet, true/false after check
  isLoading: boolean
  error: string | null
}

interface ConsentActions {
  checkConsent: () => Promise<void>
  recordConsent: () => Promise<void>
  reset: () => void
}

type ConsentStore = ConsentState & ConsentActions

export const useConsentStore = create<ConsentStore>((set, get) => ({
  // State
  consent: null,
  needsConsent: null,
  isLoading: false,
  error: null,

  // Actions
  /**
   * Check if user needs to consent (or re-consent).
   * Caches result in memory for the session.
   *
   * Version checking is done server-side - backend compares stored consent
   * versions against current policy versions.
   */
  checkConsent: async () => {
    // If already checked this session, don't check again
    if (get().needsConsent !== null) {
      return
    }

    set({ isLoading: true, error: null })
    try {
      const status = await checkConsentStatus()

      set({
        consent: status.current_consent,
        needsConsent: status.needs_consent,
        isLoading: false
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check consent'
      set({ isLoading: false, error: message })
    }
  },

  /**
   * Record user's consent with current policy versions.
   */
  recordConsent: async () => {
    set({ isLoading: true, error: null })
    try {
      const consent = await recordMyConsent({
        privacy_policy_version: PRIVACY_POLICY_VERSION,
        terms_of_service_version: TERMS_OF_SERVICE_VERSION,
      })

      set({
        consent,
        needsConsent: false,
        isLoading: false
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record consent'
      set({ isLoading: false, error: message })
      throw err  // Re-throw so UI can handle
    }
  },

  /**
   * Reset consent state (e.g., on logout).
   */
  reset: () => {
    set({
      consent: null,
      needsConsent: null,
      isLoading: false,
      error: null,
    })
  },
}))
