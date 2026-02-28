import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsClaudeDesktop } from './DocsClaudeDesktop'

vi.mock('../../config', () => ({
  config: {
    apiUrl: 'http://localhost:8000',
    mcpUrl: 'http://localhost:8001',
    promptMcpUrl: 'http://localhost:8002',
  },
  isDevMode: false,
}))

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { tags: [] } }),
  },
}))

function renderPage(): void {
  render(
    <MemoryRouter>
      <DocsClaudeDesktop />
    </MemoryRouter>
  )
}

describe('DocsClaudeDesktop', () => {
  it('should render page title', () => {
    renderPage()
    expect(screen.getByText('Tiddly + Claude Desktop')).toBeInTheDocument()
  })

  it('should show combined JSON config with both servers', () => {
    renderPage()

    const codeBlocks = document.querySelectorAll('pre code')
    const configBlock = Array.from(codeBlocks).find((el) =>
      el.textContent?.includes('bookmarks_notes') && el.textContent?.includes('"prompts"')
    )
    expect(configBlock).toBeTruthy()
    expect(configBlock?.textContent).toContain('http://localhost:8001/mcp')
    expect(configBlock?.textContent).toContain('http://localhost:8002/mcp')
  })

  it('should show macOS and Windows config file paths', () => {
    renderPage()

    expect(screen.getByText(/macOS:/)).toBeInTheDocument()
    expect(screen.getByText(/Windows:/)).toBeInTheDocument()
  })

  it('should show Restart Claude Desktop step', () => {
    renderPage()
    expect(screen.getByText('Step 4: Restart Claude Desktop')).toBeInTheDocument()
  })
})
