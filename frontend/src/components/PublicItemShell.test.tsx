/**
 * Tests for PublicItemShell: the loading / not-found / archived states and the
 * logged-out "what is Tiddly?" blurb (shown only to anonymous visitors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PublicItemShell } from './PublicItemShell'

vi.mock('./SaveACopy', () => ({ SaveACopy: () => <button>save-stub</button> }))

// `mock`-prefixed so the hoisted factory may reference it.
let mockAuth: { isAuthenticated: boolean; isLoading: boolean; error: Error | null; userId: string | null }
vi.mock('../hooks/useAuthStatus', () => ({ useAuthStatus: () => mockAuth }))

// axios.isAxiosError only checks `isAxiosError === true`, so a plain shape works.
const axiosErr = (status?: number): unknown => ({
  isAxiosError: true,
  response: status === undefined ? undefined : { status },
})

function renderShell(overrides: {
  isLoading?: boolean
  isError?: boolean
  isArchived?: boolean
  error?: unknown
  onRetry?: () => void
} = {}): void {
  render(
    <MemoryRouter>
      <PublicItemShell
        type="notes"
        token="tok"
        isLoading={overrides.isLoading ?? false}
        isError={overrides.isError ?? false}
        error={overrides.error}
        onRetry={overrides.onRetry}
        isArchived={overrides.isArchived ?? false}
      >
        <div>item content</div>
      </PublicItemShell>
    </MemoryRouter>
  )
}

const BLURB = /Tiddly is a home for your bookmarks/

describe('PublicItemShell', () => {
  beforeEach(() => {
    mockAuth = { isAuthenticated: true, isLoading: false, error: null, userId: 'u' }
  })

  it('shows the "what is Tiddly" blurb only when logged out', () => {
    mockAuth = { isAuthenticated: false, isLoading: false, error: null, userId: null }
    renderShell()
    expect(screen.getByText(BLURB)).toBeInTheDocument()
  })

  it('hides the blurb when authenticated', () => {
    renderShell()
    expect(screen.queryByText(BLURB)).toBeNull()
    expect(screen.getByText('item content')).toBeInTheDocument()
  })

  it('renders the archived badge when archived', () => {
    renderShell({ isArchived: true })
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('renders the loading state', () => {
    renderShell({ isLoading: true })
    expect(screen.getByText('Loading shared item...')).toBeInTheDocument()
  })

  it('renders the not-found state for a 404 (gone / unshared)', () => {
    renderShell({ isError: true, error: axiosErr(404) })
    expect(screen.getByText(/isn’t available/i)).toBeInTheDocument()
    // Not a transient-error message and no retry button for a real 404.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('shows a rate-limit message (not "unshared") for a 429', () => {
    renderShell({ isError: true, error: axiosErr(429) })
    expect(screen.getByText(/too quickly/i)).toBeInTheDocument()
    expect(screen.queryByText(/stopped sharing/i)).toBeNull()
  })

  it('shows a transient "couldn’t load" message + retry for a 5xx/network error', async () => {
    const onRetry = vi.fn()
    renderShell({ isError: true, error: axiosErr(500), onRetry })
    expect(screen.getByText(/check your connection/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
