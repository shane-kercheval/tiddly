import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, setupAuthInterceptor } from './api'
import { config } from '../config'
import { useConsentStore } from '../stores/consentStore'
import toast from 'react-hot-toast'
import { isValidElement } from 'react'

vi.mock('../config', () => ({
  config: {
    apiUrl: 'http://localhost:8000',
  },
  isDevMode: false,
}))

// Mock the consent store
vi.mock('../stores/consentStore', () => ({
  useConsentStore: {
    getState: vi.fn(),
  },
}))

// Mock the session-expiry store (the 401-final path parks requests in it)
const mockParkRequest = vi.fn()
vi.mock('../stores/sessionExpiryStore', () => ({
  useSessionExpiryStore: {
    getState: () => ({ parkRequest: mockParkRequest }),
  },
}))

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}))

// Type for accessing internal axios interceptor handlers
interface AxiosInterceptorHandler {
  fulfilled?: (value: unknown) => unknown
  rejected?: (error: unknown) => unknown
}

/** Get the last registered response error handler. */
function getErrorHandler(): ((error: unknown) => unknown) | undefined {
  const handlers = (api.interceptors.response as unknown as { handlers: AxiosInterceptorHandler[] }).handlers
  return handlers[handlers.length - 1]?.rejected
}

/** Extract text content from a React element's props (shallow). */
function getToastText(): string {
  const call = vi.mocked(toast.error).mock.calls[0]
  if (!call) return ''
  const element = call[0]
  if (typeof element === 'string') return element
  // React element — extract children text recursively
  if (isValidElement(element) && element.props) {
    const children = (element.props as { children?: unknown }).children
    return Array.isArray(children)
      ? children.map((c: unknown) => {
          if (typeof c === 'string') return c
          if (isValidElement(c) && c.props) return (c.props as { children?: string }).children ?? ''
          return ''
        }).join('')
      : String(children ?? '')
  }
  return ''
}

/** Extract the href from the first anchor element in the toast JSX. */
function getToastLinkHref(): string | null {
  const call = vi.mocked(toast.error).mock.calls[0]
  if (!call) return null
  const element = call[0]
  if (!isValidElement(element) || !element.props) return null
  const children = (element.props as { children?: unknown }).children
  if (!Array.isArray(children)) return null
  for (const child of children) {
    if (isValidElement(child)) {
      const href = (child.props as { href?: string }).href
      if (href) return href
    }
  }
  return null
}

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
  const mockHandleConsentRequired = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useConsentStore.getState).mockReturnValue({
      consent: null,
      needsConsent: null,
      currentPrivacyVersion: null,
      currentTermsVersion: null,
      isLoading: false,
      error: null,
      reset: vi.fn(),
      checkConsent: vi.fn(),
      handleConsentRequired: mockHandleConsentRequired,
      recordConsent: vi.fn(),
    })
  })

  describe('451 response handling', () => {
    it('calls handleConsentRequired when 451 is received', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock451Error = {
        response: { status: 451 },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock451Error)).rejects.toEqual(mock451Error)
      }

      expect(mockHandleConsentRequired).toHaveBeenCalledTimes(1)
    })

    it('does not call handleConsentRequired for non-451 errors', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock500Error = {
        response: { status: 500 },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock500Error)).rejects.toEqual(mock500Error)
      }

      expect(mockHandleConsentRequired).not.toHaveBeenCalled()
    })
  })

  describe('402 response handling', () => {
    it('shows quota exceeded toast with pricing link', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock402Error = {
        response: {
          status: 402,
          data: { error_code: 'QUOTA_EXCEEDED', resource: 'bookmark', limit: 10, current: 10 },
        },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock402Error)).rejects.toEqual(mock402Error)
      }

      expect(toast.error).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'quota-exceeded' }
      )
      const text = getToastText()
      expect(text).toContain('10')
      expect(text).toContain('bookmarks')
      expect(text).toContain('Manage your plan')
      expect(getToastLinkHref()).toBe('/pricing')
    })

    it('does not show toast for non-quota 402', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock402Error = {
        response: {
          status: 402,
          data: { error_code: 'SOMETHING_ELSE' },
        },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock402Error)).rejects.toEqual(mock402Error)
      }

      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('429 response handling', () => {
    it('shows toast with retry-after and pricing link when 429 with header', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock429Error = {
        response: {
          status: 429,
          headers: { 'retry-after': '30' },
        },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock429Error)).rejects.toEqual(mock429Error)
      }

      expect(toast.error).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'rate-limit' }
      )
      const text = getToastText()
      expect(text).toContain('30 seconds')
      expect(text).toContain('Higher limits available')
      expect(getToastLinkHref()).toBe('/pricing')
    })

    it('shows provider-busy toast without pricing link or retry-after on 429 with llm_rate_limited', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      // Upstream LLM provider throttle — backend does not set Retry-After,
      // so the toast must not render a "wait N seconds" countdown.
      const mock429Error = {
        response: {
          status: 429,
          headers: {},
          data: { error_code: 'llm_rate_limited', detail: 'LLM provider rate limit exceeded.' },
        },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock429Error)).rejects.toEqual(mock429Error)
      }

      expect(toast.error).toHaveBeenCalledWith(
        expect.any(String),
        { id: 'rate-limit' }
      )
      const text = getToastText()
      expect(text).toContain('provider is busy')
      expect(text).not.toContain('Higher limits available')
      expect(text).not.toMatch(/\d+\s*seconds/)
      expect(text).not.toContain('undefined')
      expect(getToastLinkHref()).toBeNull()
    })

    it('shows generic toast with pricing link when 429 without retry-after', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock429Error = {
        response: {
          status: 429,
          headers: {},
        },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock429Error)).rejects.toEqual(mock429Error)
      }

      expect(toast.error).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'rate-limit' }
      )
      const text = getToastText()
      expect(text).toContain('try again later')
      expect(text).toContain('Higher limits available')
      expect(getToastLinkHref()).toBe('/pricing')
    })

    it('does not show toast for non-429 errors', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('test-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const mock500Error = {
        response: { status: 500, headers: {} },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock500Error)).rejects.toEqual(mock500Error)
      }

      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('401 response handling (one retry, then the session-expiry path)', () => {
    it('retries once with a fresh-minted token and resolves', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('fresh-token')
      setupAuthInterceptor(mockGetToken)

      const errorHandler = getErrorHandler()
      const requestSpy = vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })
      const mock401Error = {
        response: { status: 401 },
        config: { headers: {} },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock401Error)).resolves.toEqual({ data: 'ok' })
      }

      expect(requestSpy).toHaveBeenCalledTimes(1)
      expect(mockGetToken).toHaveBeenCalledWith({ skipCache: true })
      expect(mockParkRequest).not.toHaveBeenCalled()
      requestSpy.mockRestore()
    })

    it('parks the request for re-auth when the retry also 401s — never rejects to a logout', async () => {
      const mockGetToken = vi.fn().mockResolvedValue('fresh-token')
      setupAuthInterceptor(mockGetToken)
      mockParkRequest.mockResolvedValue({ data: 'after-reauth' })

      const errorHandler = getErrorHandler()
      // _retryAuth already set: this 401 is the retry's own failure.
      const mock401Error = {
        response: { status: 401 },
        config: { headers: {}, _retryAuth: true },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock401Error)).resolves.toEqual({ data: 'after-reauth' })
      }

      expect(mockParkRequest).toHaveBeenCalledTimes(1)
      // The parked retry callback must clear the retry marker and replay via api.request
      const retryFn = mockParkRequest.mock.calls[0]?.[0] as () => Promise<unknown>
      const requestSpy = vi.spyOn(api, 'request').mockResolvedValue({ data: 'replayed' })
      await expect(retryFn()).resolves.toEqual({ data: 'replayed' })
      expect(requestSpy).toHaveBeenCalledTimes(1)
      requestSpy.mockRestore()
    })

    it('parks the request when no token can be minted at all (no session)', async () => {
      const mockGetToken = vi.fn().mockResolvedValue(null)
      setupAuthInterceptor(mockGetToken)
      mockParkRequest.mockResolvedValue({ data: 'after-reauth' })

      const errorHandler = getErrorHandler()
      const mock401Error = {
        response: { status: 401 },
        config: { headers: {} },
        isAxiosError: true,
      }

      if (errorHandler) {
        await expect(errorHandler(mock401Error)).resolves.toEqual({ data: 'after-reauth' })
      }

      expect(mockGetToken).toHaveBeenCalledWith({ skipCache: true })
      expect(mockParkRequest).toHaveBeenCalledTimes(1)
    })
  })
})
