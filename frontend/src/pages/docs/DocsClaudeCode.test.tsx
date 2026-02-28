import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsClaudeCode } from './DocsClaudeCode'

// Mock config
vi.mock('../../config', () => ({
  config: {
    apiUrl: 'http://localhost:8000',
    mcpUrl: 'http://localhost:8001',
    promptMcpUrl: 'http://localhost:8002',
  },
  isDevMode: false,
}))

// Mock API service
const mockApiGet = vi.fn()
vi.mock('../../services/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

// Mock clipboard
const mockWriteText = vi.fn().mockResolvedValue(undefined)
beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    configurable: true,
  })
})

function renderPage(): void {
  render(
    <MemoryRouter>
      <DocsClaudeCode />
    </MemoryRouter>
  )
}

describe('DocsClaudeCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet.mockResolvedValue({
      data: {
        tags: [
          { name: 'skill', content_count: 5, filter_count: 0 },
          { name: 'coding', content_count: 3, filter_count: 0 },
        ],
      },
    })
  })

  it('should render page title', () => {
    renderPage()
    expect(screen.getByText('Tiddly + Claude Code')).toBeInTheDocument()
  })

  it('should show Create a Personal Access Token step with link', () => {
    renderPage()
    expect(screen.getByText('Step 1: Create a Personal Access Token')).toBeInTheDocument()
    const tokenLink = screen.getByRole('link', { name: /Create Token/i })
    expect(tokenLink).toHaveAttribute('href', '/app/settings/tokens')
  })

  it('should show Content server setup with correct command', () => {
    renderPage()
    expect(screen.getByText('Step 2: Add Content Server')).toBeInTheDocument()

    const codeBlocks = document.querySelectorAll('pre code')
    const contentBlock = Array.from(codeBlocks).find((el) =>
      el.textContent?.includes('bookmarks_notes')
    )
    expect(contentBlock?.textContent).toContain('http://localhost:8001/mcp')
    expect(contentBlock?.textContent).toContain('claude mcp add --transport http bookmarks_notes')
  })

  it('should show Prompt server setup with correct command', () => {
    renderPage()
    expect(screen.getByText('Step 3: Add Prompt Server')).toBeInTheDocument()

    const codeBlocks = document.querySelectorAll('pre code')
    const promptBlock = Array.from(codeBlocks).find((el) =>
      el.textContent?.includes('http://localhost:8002/mcp')
    )
    expect(promptBlock?.textContent).toContain('claude mcp add --transport http prompts')
  })

  it('should show both servers inline (no server selector)', () => {
    renderPage()
    const text = document.body.textContent || ''
    expect(text).toContain('bookmarks_notes')
    expect(text).toContain('http://localhost:8001/mcp')
    expect(text).toContain('http://localhost:8002/mcp')
  })

  it('should have copy buttons', () => {
    renderPage()
    const copyButtons = screen.getAllByText('Copy')
    expect(copyButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('should show Import from Claude Desktop alternative', () => {
    renderPage()
    expect(screen.getByText(/Import from Claude Desktop/)).toBeInTheDocument()
    expect(screen.getByText('claude mcp add-from-claude-desktop')).toBeInTheDocument()
  })

  it('should show Agent Skills section', () => {
    renderPage()
    expect(screen.getByText('Agent Skills')).toBeInTheDocument()
  })

  it('should fetch tags when authenticated', async () => {
    renderPage()
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/tags/?content_types=prompt')
    })
    expect(screen.getByText('Filter by Tags (Optional)')).toBeInTheDocument()
  })

  it('should show example prompts section', () => {
    renderPage()
    expect(screen.getByText('Example Prompts')).toBeInTheDocument()
  })

  it('should show sync command for skills', () => {
    renderPage()
    expect(screen.getByText('Sync Skills')).toBeInTheDocument()
    const text = document.body.textContent || ''
    expect(text).toContain('~/.claude/skills/')
    expect(text).toContain('/prompts/export/skills')
  })
})
