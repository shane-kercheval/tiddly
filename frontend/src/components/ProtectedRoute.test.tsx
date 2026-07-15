/**
 * Tests for ProtectedRoute's non-happy branches — most importantly the auth
 * error screen, which regressed to dead code once during the Clerk swap
 * (the seam hardcoded error: null) and got no test to catch it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './ProtectedRoute'
import { useSessionExpiryStore } from '../stores/sessionExpiryStore'

vi.mock('../config', () => ({
  isDevMode: false,
  config: { apiUrl: 'http://localhost:8000' },
}))

let mockAuthStatus: {
  isAuthenticated: boolean
  isLoading: boolean
  error: Error | null
  userId: string | null
  userEmail: string | null
} = { isAuthenticated: true, isLoading: false, error: null, userId: 'u', userEmail: null }
vi.mock('../hooks/useAuthStatus', () => ({ useAuthStatus: () => mockAuthStatus }))

function renderRoute(): void {
  render(
    <MemoryRouter>
      <ProtectedRoute />
    </MemoryRouter>
  )
}

/** Full route tree so navigation-vs-stay is observable. */
function AppTree(): React.ReactElement {
  return (
    <Routes>
      <Route path="/" element={<div>landing-page</div>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<div>app-content</div>} />
      </Route>
    </Routes>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionExpiryStore.setState({
      expired: false,
      deliberateLogout: false,
      pending: [],
    })
    mockAuthStatus = {
      isAuthenticated: true,
      isLoading: false,
      error: null,
      userId: 'u',
      userEmail: null,
    }
  })

  it('bounces a cold unauthenticated visit to the landing page', () => {
    mockAuthStatus = { ...mockAuthStatus, isAuthenticated: false }
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AppTree />
      </MemoryRouter>
    )
    expect(screen.getByText('landing-page')).toBeInTheDocument()
  })

  it('stays mounted and raises the expiry dialog when the session dies mid-use', () => {
    // The plan M3 step-7 contract: becoming signed-out must never navigate —
    // caught live in the rehearsal when a revoked session bounced the user
    // (and their unsaved editor) to the landing page.
    const { rerender } = render(
      <MemoryRouter initialEntries={['/app']}>
        <AppTree />
      </MemoryRouter>
    )
    expect(screen.getByText('app-content')).toBeInTheDocument()

    mockAuthStatus = { ...mockAuthStatus, isAuthenticated: false }
    rerender(
      <MemoryRouter initialEntries={['/app']}>
        <AppTree />
      </MemoryRouter>
    )
    expect(screen.getByText('app-content')).toBeInTheDocument()
    expect(screen.queryByText('landing-page')).toBeNull()
    expect(useSessionExpiryStore.getState().expired).toBe(true)
  })

  it('deliberate logout still navigates away instead of raising the dialog', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/app']}>
        <AppTree />
      </MemoryRouter>
    )
    expect(screen.getByText('app-content')).toBeInTheDocument()

    useSessionExpiryStore.getState().beginDeliberateLogout()
    mockAuthStatus = { ...mockAuthStatus, isAuthenticated: false }
    rerender(
      <MemoryRouter initialEntries={['/app']}>
        <AppTree />
      </MemoryRouter>
    )
    expect(screen.getByText('landing-page')).toBeInTheDocument()
    expect(useSessionExpiryStore.getState().expired).toBe(false)
  })

  it('shows the loading spinner while auth initializes', () => {
    mockAuthStatus = { ...mockAuthStatus, isAuthenticated: false, isLoading: true }
    renderRoute()
    expect(screen.getByText('Authenticating...')).toBeInTheDocument()
  })

  it('shows the recovery screen when the auth provider fails to initialize', () => {
    // The seam reports errors only on hard init failure (clerk.status ===
    // 'error'), with isLoading forced false so this branch is reachable.
    mockAuthStatus = {
      ...mockAuthStatus,
      isAuthenticated: false,
      isLoading: false,
      error: new Error('Authentication service failed to load. Please try again.'),
    }
    renderRoute()
    expect(screen.getByText('Authentication Error')).toBeInTheDocument()
    expect(
      screen.getByText('Authentication service failed to load. Please try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
  })
})
