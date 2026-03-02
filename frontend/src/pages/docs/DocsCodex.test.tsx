import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsCodex } from './DocsCodex'

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
      <DocsCodex />
    </MemoryRouter>
  )
}

describe('DocsCodex', () => {
  it('should render page title', () => {
    renderPage()
    expect(screen.getByText('Tiddly + Codex')).toBeInTheDocument()
  })

  it('should show combined TOML config with both servers', () => {
    renderPage()

    const codeBlocks = document.querySelectorAll('pre code')
    const configBlock = Array.from(codeBlocks).find((el) =>
      el.textContent?.includes('[mcp_servers.bookmarks_notes]') &&
      el.textContent?.includes('[mcp_servers.prompts]')
    )
    expect(configBlock).toBeTruthy()
    expect(configBlock?.textContent).toContain('http://localhost:8001/mcp')
    expect(configBlock?.textContent).toContain('http://localhost:8002/mcp')
  })

  it('should show Using Your Prompts note', () => {
    renderPage()
    expect(screen.getByText('Using Your Prompts')).toBeInTheDocument()
    expect(screen.getByText(/Codex does not support MCP Prompts directly/)).toBeInTheDocument()
  })
})
