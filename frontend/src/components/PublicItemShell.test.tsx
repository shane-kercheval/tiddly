/**
 * Tests for PublicItemShell: the loading / not-found / archived states and the
 * logged-out "what is Tiddly?" blurb (shown only to anonymous visitors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PublicItemShell } from './PublicItemShell'

vi.mock('./SaveACopy', () => ({ SaveACopy: () => <button>save-stub</button> }))

// `mock`-prefixed so the hoisted factory may reference it.
let mockAuth: { isAuthenticated: boolean; isLoading: boolean; error: Error | null; userId: string | null }
vi.mock('../hooks/useAuthStatus', () => ({ useAuthStatus: () => mockAuth }))

function renderShell(overrides: { isLoading?: boolean; isError?: boolean; isArchived?: boolean } = {}): void {
  render(
    <MemoryRouter>
      <PublicItemShell
        type="notes"
        token="tok"
        isLoading={overrides.isLoading ?? false}
        isError={overrides.isError ?? false}
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

  it('renders the not-found state', () => {
    renderShell({ isError: true })
    expect(screen.getByText(/available/i)).toBeInTheDocument()
  })
})
