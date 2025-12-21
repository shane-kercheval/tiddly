/**
 * Tests for useConsentStore.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { useConsentStore } from './consentStore'
import * as api from '../services/api'

vi.mock('../services/api', () => ({
  checkConsentStatus: vi.fn(),
  recordMyConsent: vi.fn(),
}))

const mockCheckConsentStatus = api.checkConsentStatus as Mock
const mockRecordMyConsent = api.recordMyConsent as Mock

describe('useConsentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state before each test
    useConsentStore.setState({
      consent: null,
      needsConsent: null,
      currentPrivacyVersion: null,
      currentTermsVersion: null,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('has null consent and needsConsent initially', () => {
      const state = useConsentStore.getState()
      expect(state.consent).toBeNull()
      expect(state.needsConsent).toBeNull()
      expect(state.currentPrivacyVersion).toBeNull()
      expect(state.currentTermsVersion).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('checkConsent', () => {
    it('fetches consent status and updates state when user needs consent', async () => {
      mockCheckConsentStatus.mockResolvedValueOnce({
        needs_consent: true,
        current_consent: null,
        current_privacy_version: '2024-12-20',
        current_terms_version: '2024-12-20',
      })

      const { checkConsent } = useConsentStore.getState()
      await checkConsent()

      const state = useConsentStore.getState()
      expect(state.needsConsent).toBe(true)
      expect(state.consent).toBeNull()
      expect(state.currentPrivacyVersion).toBe('2024-12-20')
      expect(state.currentTermsVersion).toBe('2024-12-20')
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('fetches consent status when user has valid consent', async () => {
      const mockConsent = {
        id: 1,
        user_id: 123,
        consented_at: '2024-12-20T00:00:00Z',
        privacy_policy_version: '2024-12-20',
        terms_of_service_version: '2024-12-20',
        ip_address: '127.0.0.1',
        user_agent: 'Test Browser',
      }
      mockCheckConsentStatus.mockResolvedValueOnce({
        needs_consent: false,
        current_consent: mockConsent,
        current_privacy_version: '2024-12-20',
        current_terms_version: '2024-12-20',
      })

      const { checkConsent } = useConsentStore.getState()
      await checkConsent()

      const state = useConsentStore.getState()
      expect(state.needsConsent).toBe(false)
      expect(state.consent).toEqual(mockConsent)
      expect(state.currentPrivacyVersion).toBe('2024-12-20')
      expect(state.currentTermsVersion).toBe('2024-12-20')
    })

    it('caches result and does not re-fetch if already checked', async () => {
      mockCheckConsentStatus.mockResolvedValueOnce({
        needs_consent: false,
        current_consent: null,
        current_privacy_version: '2024-12-20',
        current_terms_version: '2024-12-20',
      })

      const { checkConsent } = useConsentStore.getState()
      await checkConsent()
      await checkConsent() // Second call should be cached

      expect(mockCheckConsentStatus).toHaveBeenCalledTimes(1)
    })

    it('sets error on API failure', async () => {
      mockCheckConsentStatus.mockRejectedValueOnce(new Error('Network error'))

      const { checkConsent } = useConsentStore.getState()
      await checkConsent()

      const state = useConsentStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.isLoading).toBe(false)
      expect(state.needsConsent).toBeNull() // Not set on error
    })
  })

  describe('recordConsent', () => {
    it('records consent with versions from API and updates state', async () => {
      // First, simulate checkConsent to populate versions
      useConsentStore.setState({
        needsConsent: true,
        currentPrivacyVersion: '2024-12-20',
        currentTermsVersion: '2024-12-20',
      })

      const mockConsent = {
        id: 1,
        user_id: 123,
        consented_at: '2024-12-20T00:00:00Z',
        privacy_policy_version: '2024-12-20',
        terms_of_service_version: '2024-12-20',
        ip_address: '127.0.0.1',
        user_agent: 'Test Browser',
      }
      mockRecordMyConsent.mockResolvedValueOnce(mockConsent)

      const { recordConsent } = useConsentStore.getState()
      await recordConsent()

      const state = useConsentStore.getState()
      expect(state.needsConsent).toBe(false)
      expect(state.consent).toEqual(mockConsent)
      expect(state.isLoading).toBe(false)
      expect(mockRecordMyConsent).toHaveBeenCalledWith({
        privacy_policy_version: '2024-12-20',
        terms_of_service_version: '2024-12-20',
      })
    })

    it('throws error if versions not loaded', async () => {
      // Don't set versions - they should be null
      const { recordConsent } = useConsentStore.getState()

      await expect(recordConsent()).rejects.toThrow(
        'Policy versions not loaded. Call checkConsent first.'
      )
    })

    it('sets error and re-throws on API failure', async () => {
      useConsentStore.setState({
        needsConsent: true,
        currentPrivacyVersion: '2024-12-20',
        currentTermsVersion: '2024-12-20',
      })
      mockRecordMyConsent.mockRejectedValueOnce(new Error('Server error'))

      const { recordConsent } = useConsentStore.getState()

      await expect(recordConsent()).rejects.toThrow('Server error')

      const state = useConsentStore.getState()
      expect(state.error).toBe('Server error')
      expect(state.isLoading).toBe(false)
      expect(state.needsConsent).toBe(true) // Still needs consent
    })
  })

  describe('reset', () => {
    it('resets all state to initial values', () => {
      // Set some state
      useConsentStore.setState({
        consent: { id: 1 } as api.ConsentResponse,
        needsConsent: false,
        currentPrivacyVersion: '2024-12-20',
        currentTermsVersion: '2024-12-20',
        isLoading: true,
        error: 'Some error',
      })

      const { reset } = useConsentStore.getState()
      reset()

      const state = useConsentStore.getState()
      expect(state.consent).toBeNull()
      expect(state.needsConsent).toBeNull()
      expect(state.currentPrivacyVersion).toBeNull()
      expect(state.currentTermsVersion).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('version mismatch scenario', () => {
    it('returns needsConsent=true when stored consent has old versions', async () => {
      const mockConsent = {
        id: 1,
        user_id: 123,
        consented_at: '2024-01-01T00:00:00Z',
        privacy_policy_version: '2024-01-01', // Old version
        terms_of_service_version: '2024-01-01', // Old version
        ip_address: '127.0.0.1',
        user_agent: 'Test Browser',
      }
      mockCheckConsentStatus.mockResolvedValueOnce({
        needs_consent: true, // Backend determines this based on version mismatch
        current_consent: mockConsent,
        current_privacy_version: '2024-12-20', // New version
        current_terms_version: '2024-12-20', // New version
      })

      const { checkConsent } = useConsentStore.getState()
      await checkConsent()

      const state = useConsentStore.getState()
      expect(state.needsConsent).toBe(true)
      expect(state.consent).toEqual(mockConsent)
      // New versions should be available for re-consent
      expect(state.currentPrivacyVersion).toBe('2024-12-20')
      expect(state.currentTermsVersion).toBe('2024-12-20')
    })
  })
})
