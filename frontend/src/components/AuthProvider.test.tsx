import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider } from './AuthProvider'
import { setupAuthInterceptor } from '../services/api'
import { useAuth0 } from '@auth0/auth0-react'
import { useAuthStatus } from '../hooks/useAuthStatus'
import { useAuthActions } from '../hooks/useAuthActions'

// The global setup (test/setup.ts) mocks the seam hooks module-wide; these
// tests exist to verify the REAL seam bridge (seam call -> SDK call), so the
// real modules must be used — otherwise the probe below would silently read
// the global stub and pass regardless of the bridge's wiring. The assertion
// values are chosen to be impossible under the stub (its login is a no-op and
// its userId is 'test-user-id'), so a regression of this unmock fails loudly.
vi.unmock('../hooks/useAuthStatus')
vi.unmock('../hooks/useAuthActions')

const mockGetAccessTokenSilently = vi.fn().mockResolvedValue('token')
const mockLogout = vi.fn()
const mockLoginWithRedirect = vi.fn()

let mockIsDevMode = false

vi.mock('../config', () => ({
  config: {
    auth0: {
      domain: 'test.auth0.com',
      clientId: 'test-client',
      audience: 'test-audience',
    },
  },
  get isDevMode() {
    return mockIsDevMode
  },
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

// Renders what the real seam delivers to a consuming component: status as
// text, actions as buttons — so tests exercise the seam the way call sites do.
function SeamProbe(): ReactNode {
  const status = useAuthStatus()
  const { login, logout } = useAuthActions()
  return (
    <div>
      <span data-testid="user-id">{String(status.userId)}</span>
      <span data-testid="user-email">{String(status.userEmail)}</span>
      <span data-testid="is-authenticated">{String(status.isAuthenticated)}</span>
      <button onClick={() => login({ mode: 'signup', returnTo: '/app/save-shared/notes/tok' })}>
        signup-with-return
      </button>
      <button onClick={() => login()}>default-login</button>
      <button onClick={() => logout()}>seam-logout</button>
    </div>
  )
}

function renderWithProbe(): void {
  render(
    <MemoryRouter>
      <AuthProvider>
        <SeamProbe />
      </AuthProvider>
    </MemoryRouter>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDevMode = false
    vi.mocked(useAuth0).mockReturnValue({
      getAccessTokenSilently: mockGetAccessTokenSilently,
      logout: mockLogout,
      loginWithRedirect: mockLoginWithRedirect,
      user: { sub: 'auth0|abc123', email: 'real@example.com' },
      isAuthenticated: true,
      isLoading: false,
      error: undefined,
    } as unknown as ReturnType<typeof useAuth0>)
  })

  it('passes cache options through to getAccessTokenSilently', async () => {
    // AuthProvider lives inside the data router in production (it uses
    // useNavigate for the post-login returnTo redirect), so provide Router context.
    render(
      <MemoryRouter>
        <AuthProvider>
          <div>child</div>
        </AuthProvider>
      </MemoryRouter>
    )

    await waitFor(() => expect(setupAuthInterceptor).toHaveBeenCalledTimes(1))
    const getAccessToken = vi.mocked(setupAuthInterceptor).mock.calls[0]?.[0]

    await getAccessToken?.({ cacheMode: 'off' })

    expect(mockGetAccessTokenSilently).toHaveBeenCalledWith({ cacheMode: 'off' })
  })

  describe('seam bridge (the only module allowed to touch the SDK)', () => {
    it('login({ mode: signup, returnTo }) maps to screen_hint + appState', async () => {
      renderWithProbe()
      await userEvent.click(screen.getByRole('button', { name: 'signup-with-return' }))
      expect(mockLoginWithRedirect).toHaveBeenCalledWith({
        appState: { returnTo: '/app/save-shared/notes/tok' },
        authorizationParams: { screen_hint: 'signup' },
      })
    })

    it('login() defaults to the login screen with no appState', async () => {
      renderWithProbe()
      await userEvent.click(screen.getByRole('button', { name: 'default-login' }))
      expect(mockLoginWithRedirect).toHaveBeenCalledWith({
        authorizationParams: { screen_hint: 'login' },
      })
    })

    it('logout() returns the user to the app origin', async () => {
      renderWithProbe()
      await userEvent.click(screen.getByRole('button', { name: 'seam-logout' }))
      expect(mockLogout).toHaveBeenCalledWith({
        logoutParams: { returnTo: window.location.origin },
      })
    })

    it('status derives userId and userEmail from the SDK user', () => {
      renderWithProbe()
      // Values deliberately differ from the global stub ('test-user-id' /
      // 'test-user@example.com') so this cannot pass against the mock.
      expect(screen.getByTestId('user-id').textContent).toBe('auth0|abc123')
      expect(screen.getByTestId('user-email').textContent).toBe('real@example.com')
      expect(screen.getByTestId('is-authenticated').textContent).toBe('true')
    })

    it('dev mode: the seam resolves everywhere with no-op actions', async () => {
      // This property is what let call sites drop their "SDK only in
      // production" isolation wrappers — guard it.
      mockIsDevMode = true
      renderWithProbe()
      expect(screen.getByTestId('is-authenticated').textContent).toBe('true')
      expect(screen.getByTestId('user-id').textContent).toBe('dev-user')
      await userEvent.click(screen.getByRole('button', { name: 'default-login' }))
      await userEvent.click(screen.getByRole('button', { name: 'seam-logout' }))
      expect(mockLoginWithRedirect).not.toHaveBeenCalled()
      expect(mockLogout).not.toHaveBeenCalled()
    })
  })
})
