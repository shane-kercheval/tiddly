import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AccountDeleted } from './AccountDeleted'

describe('AccountDeleted', () => {
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
