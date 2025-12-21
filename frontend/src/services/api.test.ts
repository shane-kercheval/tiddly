import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, setupAuthInterceptor } from './api'
import { config } from '../config'
import { useConsentStore } from '../stores/consentStore'

// Mock the consent store
vi.mock('../stores/consentStore', () => ({
  useConsentStore: {
    getState: vi.fn(),
  },
}))

describe('api', () => {
  it('should have baseURL configured from config', () => {
    expect(api.defaults.baseURL).toBe(config.apiUrl)
  })

  it('should be an axios instance', () => {
    expect(api.get).toBeDefined()
    expect(api.post).toBeDefined()
    expect(api.put).toBeDefined()
    expect(api.delete).toBeDefined()
  })

  it('should have interceptors available', () => {
    expect(api.interceptors.request).toBeDefined()
    expect(api.interceptors.response).toBeDefined()
  })
})

describe('setupAuthInterceptor', () => {
  const mockReset = vi.fn()
  const mockCheckConsent = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useConsentStore.getState).mockReturnValue({
      reset: mockReset,
      checkConsent: mockCheckConsent,
      needsConsent: null,
      isLoading: false,
      recordConsent: vi.fn(),
    } as ReturnType<typeof useConsentStore.getState>)
  })

  describe('451 response handling', () => {
    it('calls reset and checkConsent when 451 is received', async () => {
      // Set up the interceptor
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      const mockOnAuthError = vi.fn()
      setupAuthInterceptor(mockGetToken, mockOnAuthError)

      // Simulate a 451 response by manually triggering the error handler
      const errorHandler = api.interceptors.response.handlers[
        api.interceptors.response.handlers.length - 1
      ]?.rejected

      const mock451Error = {
        response: { status: 451 },
        isAxiosError: true,
      }

      // The handler should reject the promise but still call reset/checkConsent
      if (errorHandler) {
        await expect(errorHandler(mock451Error)).rejects.toEqual(mock451Error)
      }

      expect(mockReset).toHaveBeenCalledTimes(1)
      expect(mockCheckConsent).toHaveBeenCalledTimes(1)
    })

    it('does not call reset for non-451 errors', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      const mockOnAuthError = vi.fn()
      setupAuthInterceptor(mockGetToken, mockOnAuthError)

      const errorHandler = api.interceptors.response.handlers[
        api.interceptors.response.handlers.length - 1
      ]?.rejected

      const mock500Error = {
        response: { status: 500 },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock500Error)).rejects.toEqual(mock500Error)
      }

      expect(mockReset).not.toHaveBeenCalled()
      expect(mockCheckConsent).not.toHaveBeenCalled()
    })
  })
})
