import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsAIHub } from './DocsAIHub'

// Mock the API module used by AISetupWidget
vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: {
        tags: [
          { name: 'skill', content_count: 3 },
          { name: 'python', content_count: 5 },
        ],
      },
    }),
  },
}))

const mockWriteText = vi.fn().mockResolvedValue(undefined)

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    writable: true,
  })
})

function renderPage(): void {
  render(
    <MemoryRouter>
      <DocsAIHub />
    </MemoryRouter>
  )
}

describe('DocsAIHub', () => {
  it('should render page heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'AI Integration', level: 1 })).toBeInTheDocument()
  })

  it('should render MCP intro text', () => {
    renderPage()
    expect(screen.getByText(/Model Context Protocol/)).toBeInTheDocument()
    expect(screen.getByText(/Agent Skills/)).toBeInTheDocument()
  })

  it('should render the AI setup widget with CLI tab', () => {
    renderPage()
    expect(screen.getByTestId('cli-setup-section')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Setup via CLI (Recommended)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Setup via Curl/PAT' })).toBeInTheDocument()
  })

  it('should render example prompts section', () => {
    renderPage()
    expect(screen.getByText('Example Prompts')).toBeInTheDocument()
    expect(screen.getByText(/Search my bookmarks about React hooks/)).toBeInTheDocument()
  })
})
