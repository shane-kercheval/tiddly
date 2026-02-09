import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider } from './AuthProvider'
import { setupAuthInterceptor } from '../services/api'
import { useAuth0 } from '@auth0/auth0-react'

const mockGetAccessTokenSilently = vi.fn().mockResolvedValue('token')
const mockLogout = vi.fn()

vi.mock('../config', () => ({
  config: {
    auth0: {
      domain: 'test.auth0.com',
      clientId: 'test-client',
      audience: 'test-audience',
    },
  },
  isDevMode: false,
}))

vi.mock('../services/api', () => ({
  setupAuthInterceptor: vi.fn(),
}))

vi.mock('../stores/consentStore', () => ({
  useConsentStore: vi.fn(() => ({ reset: vi.fn() })),
}))

vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth0: vi.fn(),
}))

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth0).mockReturnValue({
      getAccessTokenSilently: mockGetAccessTokenSilently,
      logout: mockLogout,
      isAuthenticated: true,
      isLoading: false,
      error: undefined,
    } as unknown as ReturnType<typeof useAuth0>)
  })

  it('passes cache options through to getAccessTokenSilently', async () => {
    render(
      <AuthProvider>
        <div>child</div>
      </AuthProvider>
    )

    await waitFor(() => expect(setupAuthInterceptor).toHaveBeenCalledTimes(1))
    const getAccessToken = vi.mocked(setupAuthInterceptor).mock.calls[0]?.[0]

    await getAccessToken?.({ cacheMode: 'off' })

    expect(mockGetAccessTokenSilently).toHaveBeenCalledWith({ cacheMode: 'off' })
  })
})
