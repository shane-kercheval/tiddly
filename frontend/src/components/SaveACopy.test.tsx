/**
 * Tests for the auth-aware "Save a copy" control.
 *
 * Overrides the global useAuthStatus mock (test/setup.ts) per case to exercise
 * the three branches: initializing, authenticated, anonymous.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SaveACopy } from './SaveACopy'

// `mock`-prefixed so vitest allows referencing it inside the hoisted factory.
let mockAuthStatus: {
  isAuthenticated: boolean
  isLoading: boolean
  error: Error | null
  userId: string | null
} = { isAuthenticated: true, isLoading: false, error: null, userId: 'u' }
vi.mock('../hooks/useAuthStatus', () => ({ useAuthStatus: () => mockAuthStatus }))

const mockMutate = vi.fn()
vi.mock('../hooks/useSavePublicItem', () => ({
  useSavePublicItem: () => ({ mutate: mockMutate, isPending: false }),
}))

const mockLogin = vi.fn()
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ loginWithRedirect: mockLogin }) }))

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SaveACopy type="notes" token="tok" />
    </MemoryRouter>
  )
}

describe('SaveACopy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthStatus = { isAuthenticated: true, isLoading: false, error: null, userId: 'u' }
  })

  it('renders a neutral placeholder (no button) while auth is initializing', () => {
    mockAuthStatus = { isAuthenticated: false, isLoading: true, error: null, userId: null }
    renderAt('/shared/notes/tok')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('authenticated: shows "Save a copy" and clones on click', async () => {
    renderAt('/shared/notes/tok')
    await userEvent.click(screen.getByRole('button', { name: 'Save to Tiddly' }))
    expect(mockMutate).toHaveBeenCalledTimes(1)
  })

  it('anonymous: shows sign-in and logs in returning to the current shared URL', async () => {
    mockAuthStatus = { isAuthenticated: false, isLoading: false, error: null, userId: null }
    renderAt('/shared/notes/tok')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to save' }))
    expect(mockLogin).toHaveBeenCalledWith(
      expect.objectContaining({ appState: { returnTo: '/shared/notes/tok' } })
    )
  })
})
