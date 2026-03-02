import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { ReactNode } from 'react'
import { DocsLayout } from '../DocsLayout'

function renderDocsLayout(initialPath: string): void {
  const router = createMemoryRouter(
    [
      {
        element: <DocsLayout />,
        children: [
          { path: '/docs', element: <div>Overview Page</div> },
          { path: '/docs/ai', element: <div>AI Hub Page</div> },
          { path: '/docs/ai/claude-code', element: <div>Claude Code Page</div> },
          { path: '/docs/ai/claude-desktop', element: <div>Claude Desktop Page</div> },
          { path: '/docs/extensions', element: <div>Extensions Page</div> },
          { path: '/docs/extensions/chrome', element: <div>Chrome Extension Page</div> },
          { path: '/docs/api', element: <div>API Page</div> },
          { path: '/docs/faq', element: <div>FAQ Page</div> },
        ],
      },
    ],
    { initialEntries: [initialPath] }
  )

  render(<RouterProvider router={router} />)
}

describe('DocsLayout', () => {
  it('should render header, sidebar nav, and footer', () => {
    renderDocsLayout('/docs')

    // Header elements
    expect(screen.getByLabelText('Home')).toBeInTheDocument()
    // "Docs" appears in both header and footer
    const docsLinks = screen.getAllByRole('link', { name: 'Docs' })
    expect(docsLinks.length).toBeGreaterThanOrEqual(1)

    // Sidebar nav items
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Features' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI Integration' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'FAQ' })).toBeInTheDocument()

    // Footer
    expect(screen.getByText(/© 2025 Tiddly/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toBeInTheDocument()

    // Content renders
    expect(screen.getByText('Overview Page')).toBeInTheDocument()
  })

  it('should render all top-level nav sections', () => {
    renderDocsLayout('/docs')

    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Features' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI Integration' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Extensions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'API' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'FAQ' })).toBeInTheDocument()
  })

  it('should highlight active nav item', () => {
    renderDocsLayout('/docs')

    const overviewLink = screen.getByRole('link', { name: 'Overview' })
    expect(overviewLink).toHaveClass('bg-[#fff0e5]')
    expect(overviewLink).toHaveClass('text-[#d97b3d]')
  })

  it('should expand parent when child is active', () => {
    renderDocsLayout('/docs/ai/claude-code')

    // AI Integration parent should be visible
    expect(screen.getByRole('link', { name: 'AI Integration' })).toBeInTheDocument()

    // Child items should be visible since the parent is expanded
    expect(screen.getByRole('link', { name: 'Claude Code' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Claude Desktop' })).toBeInTheDocument()

    // Claude Code should have active styling
    const claudeCodeLink = screen.getByRole('link', { name: 'Claude Code' })
    expect(claudeCodeLink).toHaveClass('bg-[#fff0e5]')
  })

  it('should not expand parent when no child is active', () => {
    renderDocsLayout('/docs')

    // AI Integration children should NOT be visible since no child is active
    expect(screen.queryByRole('link', { name: 'Claude Code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Claude Desktop' })).not.toBeInTheDocument()
  })

  it('should render mobile menu toggle button', () => {
    renderDocsLayout('/docs')

    const toggleButton = screen.getByLabelText('Toggle docs navigation')
    expect(toggleButton).toBeInTheDocument()
  })

  it('should toggle mobile sidebar when button clicked', () => {
    renderDocsLayout('/docs')

    const toggleButton = screen.getByLabelText('Toggle docs navigation')
    const sidebar = toggleButton.closest('div')?.querySelector('aside')

    // Sidebar should be hidden on mobile by default
    expect(sidebar).toHaveClass('-translate-x-full')

    // Click toggle
    fireEvent.click(toggleButton)

    // Sidebar should now be visible
    expect(sidebar).toHaveClass('translate-x-0')
  })

  it('should render content from child route', () => {
    renderDocsLayout('/docs/ai')

    expect(screen.getByText('AI Hub Page')).toBeInTheDocument()
  })
})
