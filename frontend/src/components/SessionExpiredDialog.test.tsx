/**
 * Tests for the session-expiry UI contract (plan M3 step 7): the dialog
 * renders in place with popup OAuth pinned and a same-location redirect,
 * resumes parked requests when a session reappears, and offers no dismiss
 * path (re-auth is the only way forward; drafts protect the work).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useAuth, useSession } from '@clerk/clerk-react'
import { SessionExpiryGuard } from './SessionExpiredDialog'
import { useSessionExpiryStore } from '../stores/sessionExpiryStore'

let mockIsDevMode = false

vi.mock('../config', () => ({
  get isDevMode() {
    return mockIsDevMode
  },
}))

const mockSignInProps = vi.fn()
vi.mock('@clerk/clerk-react', () => ({
  SignIn: (props: Record<string, unknown>) => {
    mockSignInProps(props)
    return <div data-testid="clerk-sign-in" />
  },
  useAuth: vi.fn(),
  useSession: vi.fn(),
}))

function setExpired(): void {
  useSessionExpiryStore.setState({ expired: true, pending: [] })
}

describe('SessionExpiryGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDevMode = false
    useSessionExpiryStore.setState({ expired: false, pending: [] })
    vi.mocked(useAuth).mockReturnValue({
      isSignedIn: false,
    } as unknown as ReturnType<typeof useAuth>)
    vi.mocked(useSession).mockReturnValue({
      session: null,
    } as unknown as ReturnType<typeof useSession>)
  })

  it('renders nothing while the session is healthy', () => {
    render(<SessionExpiryGuard />)
    expect(screen.queryByTestId('clerk-sign-in')).toBeNull()
  })

  it('renders nothing in dev mode', () => {
    mockIsDevMode = true
    setExpired()
    render(<SessionExpiryGuard />)
    expect(screen.queryByTestId('clerk-sign-in')).toBeNull()
  })

  it('on expiry: shows the in-place dialog with popup OAuth and a same-location redirect', () => {
    setExpired()
    render(<SessionExpiryGuard />)

    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(screen.getByText('Your session expired')).toBeInTheDocument()
    // The two props that uphold the no-navigation contract:
    expect(mockSignInProps).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthFlow: 'popup',
        forceRedirectUrl: window.location.pathname + window.location.search,
      }),
    )
  })

  it('resumes parked requests on a genuine signed-out -> signed-in transition', async () => {
    // Expiry begins signed-out (a real session expiry flips isSignedIn false).
    setExpired()
    const retry = vi.fn().mockResolvedValue('replayed')
    const parked = useSessionExpiryStore.getState().parkRequest(retry, new Error('401'))

    const { rerender } = render(<SessionExpiryGuard />)
    expect(retry).not.toHaveBeenCalled()

    // User signs back in: false -> true transition triggers the replay.
    vi.mocked(useAuth).mockReturnValue({
      isSignedIn: true,
    } as unknown as ReturnType<typeof useAuth>)
    rerender(<SessionExpiryGuard />)

    await expect(parked).resolves.toBe('replayed')
    await waitFor(() =>
      expect(useSessionExpiryStore.getState().expired).toBe(false),
    )
  })

  it('does NOT auto-resume in the desync case (expired while Clerk still signed-in)', async () => {
    // The backend rejects a token Clerk's client believes is valid, so we
    // enter `expired` with isSignedIn already true and never transitioning.
    // Resuming here would loop against the backend forever.
    vi.mocked(useAuth).mockReturnValue({
      isSignedIn: true,
    } as unknown as ReturnType<typeof useAuth>)
    const retry = vi.fn().mockResolvedValue('should-not-run')
    const parked = useSessionExpiryStore.getState().parkRequest(retry, new Error('401'))
    parked.catch(() => {}) // avoid unhandled-rejection noise on cleanup

    render(<SessionExpiryGuard />)

    // The dialog is up and the request stays parked — no replay, no resolve.
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument()
    expect(retry).not.toHaveBeenCalled()
    expect(useSessionExpiryStore.getState().expired).toBe(true)
    expect(useSessionExpiryStore.getState().pending).toHaveLength(1)
  })

  it('toggles the body-level spinner-suppression class with the expired state', async () => {
    setExpired()
    const { rerender } = render(<SessionExpiryGuard />)
    expect(document.body.classList.contains('session-expired')).toBe(true)

    // Re-auth resolves the expiry (genuine false -> true transition): class
    // comes off with the dialog.
    vi.mocked(useAuth).mockReturnValue({
      isSignedIn: true,
    } as unknown as ReturnType<typeof useAuth>)
    rerender(<SessionExpiryGuard />)
    await waitFor(() =>
      expect(useSessionExpiryStore.getState().expired).toBe(false),
    )
    await waitFor(() =>
      expect(document.body.classList.contains('session-expired')).toBe(false),
    )
  })
})
