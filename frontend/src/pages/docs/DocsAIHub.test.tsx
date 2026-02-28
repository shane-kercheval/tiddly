import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsAIHub } from './DocsAIHub'

function renderPage(): void {
  render(
    <MemoryRouter>
      <DocsAIHub />
    </MemoryRouter>
  )
}

describe('DocsAIHub', () => {
  it('should render all client cards', () => {
    renderPage()

    expect(screen.getByText('Claude Desktop')).toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument()
  })

  it('should render supported client cards as links', () => {
    renderPage()

    const claudeDesktopLink = screen.getByRole('link', { name: /Claude Desktop/i })
    expect(claudeDesktopLink).toHaveAttribute('href', '/docs/ai/claude-desktop')

    const claudeCodeLink = screen.getByRole('link', { name: /Claude Code/i })
    expect(claudeCodeLink).toHaveAttribute('href', '/docs/ai/claude-code')

    const codexLink = screen.getByRole('link', { name: /Codex/i })
    expect(codexLink).toHaveAttribute('href', '/docs/ai/codex')
  })

  it('should render coming soon cards without links', () => {
    renderPage()

    const comingSoonBadges = screen.getAllByText('Coming soon')
    expect(comingSoonBadges.length).toBe(2) // ChatGPT and Gemini CLI

    // ChatGPT and Gemini CLI should NOT be links
    const allLinks = screen.getAllByRole('link')
    const linkTexts = allLinks.map((link) => link.textContent)
    expect(linkTexts).not.toContain('ChatGPT')
    expect(linkTexts).not.toContain('Gemini CLI')
  })

  it('should render example prompts section', () => {
    renderPage()

    expect(screen.getByText('Example Prompts')).toBeInTheDocument()
    expect(screen.getByText(/Search my bookmarks about React hooks/)).toBeInTheDocument()
  })

  it('should render intro text mentioning MCP and Skills', () => {
    renderPage()

    expect(screen.getByText(/Model Context Protocol/)).toBeInTheDocument()
    expect(screen.getByText(/Agent Skills/)).toBeInTheDocument()
  })

  it('should render link to MCP tools reference', () => {
    renderPage()

    const toolsLink = screen.getByRole('link', { name: /available MCP tools/i })
    expect(toolsLink).toHaveAttribute('href', '/docs/ai/mcp-tools')
  })
})
