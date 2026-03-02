import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { PublicPageLayout } from '../PublicPageLayout'

function renderWithLayout(initialPath: string): void {
  const router = createMemoryRouter(
    [
      {
        element: <PublicPageLayout />,
        children: [
          { path: '/changelog', element: <div>Changelog Content</div> },
          { path: '/roadmap', element: <div>Roadmap Content</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] }
  )

  render(<RouterProvider router={router} />)
}

describe('PublicPageLayout', () => {
  it('should render header and footer with content', () => {
    renderWithLayout('/changelog')

    // Header
    expect(screen.getByLabelText('Home')).toBeInTheDocument()
    // "Docs" appears in both header and footer
    const docsLinks = screen.getAllByRole('link', { name: 'Docs' })
    expect(docsLinks.length).toBe(2)

    // Content
    expect(screen.getByText('Changelog Content')).toBeInTheDocument()

    // Footer
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeInTheDocument()
  })

  it('should not render docs sidebar', () => {
    renderWithLayout('/changelog')

    // No sidebar nav items like "Getting Started" or "AI Integration"
    expect(screen.queryByRole('link', { name: 'Getting Started' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI Integration' })).not.toBeInTheDocument()
  })

  it('should render roadmap route content', () => {
    renderWithLayout('/roadmap')

    expect(screen.getByText('Roadmap Content')).toBeInTheDocument()
  })
})
