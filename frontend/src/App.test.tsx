import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('should redirect to dashboard in dev mode', async () => {
    render(<App />)

    // In dev mode, the landing page redirects to dashboard
    // Wait for the redirect and dashboard content to appear
    await waitFor(() => {
      expect(screen.getByText('Your Bookmarks')).toBeInTheDocument()
    })
  })

  it('should show dev mode banner in dev mode', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/Dev Mode/i)).toBeInTheDocument()
    })
  })

  it('should show Bookmarks header link', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Bookmarks' })).toBeInTheDocument()
    })
  })
})
