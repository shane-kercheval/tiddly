import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PublicHeader } from '../PublicHeader'

// useAuthStatus is globally mocked in test setup with isAuthenticated: true

describe('PublicHeader', () => {
  it('should render logo with icon and Tiddly text', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    const homeLink = screen.getByLabelText('Home')
    expect(homeLink).toHaveAttribute('href', '/')
    expect(screen.getByText('Tiddly')).toBeInTheDocument()
  })

  it('should render Docs link', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    const docsLink = screen.getByRole('link', { name: 'Docs' })
    expect(docsLink).toHaveAttribute('href', '/docs')
  })

  it('should render Pricing link', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    const pricingLink = screen.getByRole('link', { name: 'Pricing' })
    expect(pricingLink).toHaveAttribute('href', '/pricing')
  })

  it('should render Product dropdown with items on click', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    const productButton = screen.getByRole('button', { name: /Product/i })
    expect(productButton).toBeInTheDocument()

    // Dropdown not visible initially
    expect(screen.queryByRole('link', { name: 'Features' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Changelog' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Roadmap' })).not.toBeInTheDocument()

    // Click to open
    await user.click(productButton)

    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '/features')
    expect(screen.getByRole('link', { name: 'Changelog' })).toHaveAttribute('href', '/changelog')
    expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('href', '/roadmap')
  })

  it('should close Product dropdown when clicking outside', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    // Open dropdown
    await user.click(screen.getByRole('button', { name: /Product/i }))
    expect(screen.getByRole('link', { name: 'Features' })).toBeInTheDocument()

    // Click outside
    await user.click(document.body)
    expect(screen.queryByRole('link', { name: 'Features' })).not.toBeInTheDocument()
  })

  it('should show Open App when authenticated', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: 'Open App' })).toHaveAttribute('href', '/app/content')
    expect(screen.queryByText('Log In')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign Up')).not.toBeInTheDocument()
  })

  it('should hide login/signup buttons when authenticated', () => {
    render(
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: 'Open App' })).toBeInTheDocument()
    expect(screen.queryByText('Log In')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign Up')).not.toBeInTheDocument()
  })
})
