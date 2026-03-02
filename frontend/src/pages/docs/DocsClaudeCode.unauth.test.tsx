import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Override the global useAuthStatus mock BEFORE importing the component
vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isAuthenticated: false,
    isLoading: false,
    error: null,
    userId: null,
  }),
  AuthStatusContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}))

vi.mock('../../config', () => ({
  config: {
    apiUrl: 'http://localhost:8000',
    mcpUrl: 'http://localhost:8001',
    promptMcpUrl: 'http://localhost:8002',
  },
  isDevMode: false,
}))

const mockApiGet = vi.fn()
vi.mock('../../services/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

// Must import AFTER mocks are set up
import { DocsClaudeCode } from './DocsClaudeCode'

function renderPage(): void {
  render(
    <MemoryRouter>
      <DocsClaudeCode />
    </MemoryRouter>
  )
}

describe('DocsClaudeCode - unauthenticated', () => {
  it('should not make API calls when not authenticated', () => {
    renderPage()
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it('should show log in message instead of tag selector', () => {
    renderPage()
    expect(screen.getByText(/Log in/)).toBeInTheDocument()
    expect(screen.getByText(/to filter by tags/)).toBeInTheDocument()
  })

  it('should still show sync command with default URL', () => {
    renderPage()
    expect(screen.getByText('Sync Skills')).toBeInTheDocument()
    const text = document.body.textContent || ''
    expect(text).toContain('/prompts/export/skills')
  })
})
