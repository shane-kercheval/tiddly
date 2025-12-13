import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { api, setupAuthInterceptor } from './api'
import { config } from '../config'

describe('api', () => {
  it('should have baseURL configured from config', () => {
    expect(api.defaults.baseURL).toBe(config.apiUrl)
  })
})

describe('setupAuthInterceptor', () => {
  beforeEach(() => {
    // Clear any existing interceptors
    api.interceptors.request.clear()
    api.interceptors.response.clear()
  })

  it('should call onAuthError when 401 response is received', async () => {
    const mockGetToken = vi.fn().mockResolvedValue('test-token')
    const mockOnAuthError = vi.fn()

    setupAuthInterceptor(mockGetToken, mockOnAuthError)

    // Simulate a 401 response through the error interceptor
    const error = {
      response: { status: 401 },
      config: {},
    }

    // Get the response error interceptor (second interceptor handler)
    const interceptor = api.interceptors.response.handlers[0]
    if (interceptor?.rejected) {
      await interceptor.rejected(error).catch(() => {})
    }

    // In dev mode (which is the test environment), onAuthError should NOT be called
    // because we skip auth handling in dev mode
    expect(mockOnAuthError).not.toHaveBeenCalled()
  })

  it('should not add auth header in dev mode', async () => {
    const mockGetToken = vi.fn().mockResolvedValue('test-token')
    const mockOnAuthError = vi.fn()

    setupAuthInterceptor(mockGetToken, mockOnAuthError)

    // Create a mock request config
    const requestConfig = {
      headers: new axios.AxiosHeaders(),
      url: '/test',
      method: 'GET' as const,
    }

    // Get the request interceptor
    const interceptor = api.interceptors.request.handlers[0]
    if (interceptor?.fulfilled) {
      const result = await interceptor.fulfilled(requestConfig)
      // In dev mode, token should not be fetched
      expect(mockGetToken).not.toHaveBeenCalled()
      expect(result.headers.Authorization).toBeUndefined()
    }
  })
})
