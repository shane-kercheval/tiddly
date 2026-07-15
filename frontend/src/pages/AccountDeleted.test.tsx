import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AccountDeleted } from './AccountDeleted'
import { useSessionExpiryStore } from '../stores/sessionExpiryStore'

describe('AccountDeleted', () => {
  afterEach(() => {
    useSessionExpiryStore.setState({ accountDeleted: false })
  })

  it('consumes the terminal blocker exemption on mount (one-shot)', () => {
    // Set by onAccountDeleted before navigating here; the blocker stays disabled
    // globally until it's cleared, so a later same-session sign-in would lose
    // unsaved-change protection. Reaching this page must clear it.
    useSessionExpiryStore.getState().markAccountDeleted()
    expect(useSessionExpiryStore.getState().accountDeleted).toBe(true)

    render(
      <MemoryRouter>
        <AccountDeleted />
      </MemoryRouter>,
    )

    expect(useSessionExpiryStore.getState().accountDeleted).toBe(false)
  })

  it('renders a terminal message and only a homepage link (no re-auth path)', () => {
    render(
      <MemoryRouter>
        <AccountDeleted />
      </MemoryRouter>,
    )

    // getByRole/getByText throw if absent, so these assert existence.
    screen.getByRole('heading', { name: /account deleted/i })
    screen.getByText(/your tiddly account has been deleted/i)

    const home = screen.getByRole('link', { name: /return to homepage/i })
    expect(home.getAttribute('href')).toBe('/')

    // A terminal deleted screen must offer no sign-in / create-account path.
    expect(screen.queryByRole('link', { name: /sign in|log in|create|sign up/i })).toBeNull()
  })
})
