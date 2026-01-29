/**
 * Tests for SettingsMCP settings page.
 *
 * Tests MCP & Skills configuration selector and conditional instruction rendering.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SettingsMCP } from './SettingsMCP'

// Mock config
vi.mock('../../config', () => ({
  config: {
    mcpUrl: 'http://localhost:8001',
    promptMcpUrl: 'http://localhost:8002',
  },
}))

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined)

beforeAll(() => {
  // Set up clipboard mock before tests run
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: mockWriteText,
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  })
})

function renderWithRouter(): void {
  render(
    <MemoryRouter>
      <SettingsMCP />
    </MemoryRouter>
  )
}

describe('SettingsMCP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('page rendering', () => {
    it('should render page title', () => {
      renderWithRouter()

      expect(screen.getByText('AI Integration')).toBeInTheDocument()
    })

    it('should render What is MCP section when MCP is selected', () => {
      renderWithRouter()

      // MCP is selected by default
      expect(screen.getByText('What is MCP?')).toBeInTheDocument()
    })

    it('should render What are Skills section when Skills is selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Skills' }))

      expect(screen.getByText('What are Skills?')).toBeInTheDocument()
    })

    it('should render Select Integration section', () => {
      renderWithRouter()

      expect(screen.getByText('Select Integration')).toBeInTheDocument()
    })

    it('should render Setup Instructions section', () => {
      renderWithRouter()

      expect(screen.getByText('Setup Instructions')).toBeInTheDocument()
    })
  })

  describe('selector rows', () => {
    it('should render all selector row labels', () => {
      renderWithRouter()

      expect(screen.getByText('Content')).toBeInTheDocument()
      expect(screen.getByText('Client')).toBeInTheDocument()
      expect(screen.getByText('Auth')).toBeInTheDocument()
      expect(screen.getByText('Integration')).toBeInTheDocument()
    })

    it('should render server options', () => {
      renderWithRouter()

      expect(screen.getByRole('button', { name: 'Bookmarks & Notes' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Prompts' })).toBeInTheDocument()
    })

    it('should render client options', () => {
      renderWithRouter()

      expect(screen.getByRole('button', { name: 'Claude Desktop' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Claude Code' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Gemini CLI' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ChatGPT' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument()
    })

    it('should render auth options', () => {
      renderWithRouter()

      expect(screen.getByRole('button', { name: 'Bearer Token' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'OAuth' })).toBeInTheDocument()
    })

    it('should render integration options', () => {
      renderWithRouter()

      expect(screen.getByRole('button', { name: 'MCP Server' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Skills' })).toBeInTheDocument()
    })

    it('should have Bookmarks & Notes server selected by default', () => {
      renderWithRouter()

      const contentButton = screen.getByRole('button', { name: 'Bookmarks & Notes' })
      expect(contentButton).toHaveClass('bg-orange-500')
    })

    it('should have Claude Desktop selected by default', () => {
      renderWithRouter()

      const claudeDesktopButton = screen.getByRole('button', { name: 'Claude Desktop' })
      expect(claudeDesktopButton).toHaveClass('bg-orange-500')
    })
  })

  describe('server selection', () => {
    it('should switch to Prompts server when clicked', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      const promptsButton = screen.getByRole('button', { name: 'Prompts' })
      expect(promptsButton).toHaveClass('bg-orange-500')
    })

    it('should show content server config when Content is selected', () => {
      renderWithRouter()

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('bookmarks_notes')
      expect(preElement?.textContent).toContain('http://localhost:8001/mcp')
    })

    it('should show prompt server config when Prompts is selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('"prompts"')
      expect(preElement?.textContent).toContain('http://localhost:8002/mcp')
    })
  })

  describe('client selection', () => {
    it('should show Claude Desktop instructions by default', () => {
      renderWithRouter()

      expect(screen.getByText('Step 2: Locate Config File')).toBeInTheDocument()
      expect(screen.getByText(/macOS:/)).toBeInTheDocument()
      expect(screen.getByText(/Windows:/)).toBeInTheDocument()
    })

    it('should show Claude Code instructions when Claude Code is selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Claude Code' }))

      expect(screen.getByText('Step 2: Add MCP Server')).toBeInTheDocument()
      // Check for the main command in the pre block
      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('claude mcp add --transport http bookmarks')
    })

    it('should show coming soon for ChatGPT (requires OAuth)', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'ChatGPT' }))

      expect(screen.getByText('ChatGPT Integration Coming Soon')).toBeInTheDocument()
    })

    it('should show Codex instructions when Codex is selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))

      expect(screen.getByText('Step 2: Add to Config File')).toBeInTheDocument()
      // Check for the config file path
      expect(screen.getByText('~/.codex/config.toml')).toBeInTheDocument()
    })
  })

  describe('coming soon features', () => {
    it('should show coming soon message for Skills', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Skills' }))

      expect(screen.getByText('Skills Coming Soon')).toBeInTheDocument()
    })

    it('should show coming soon message for OAuth', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'OAuth' }))

      expect(screen.getByText('OAuth Coming Soon')).toBeInTheDocument()
    })

    it('should show coming soon message for ChatGPT (requires OAuth)', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'ChatGPT' }))

      expect(screen.getByText('ChatGPT Integration Coming Soon')).toBeInTheDocument()
      expect(screen.getByText(/OAuth authentication/)).toBeInTheDocument()
    })

    it('should show Codex config generation for content server', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('[mcp_servers.bookmarks]')
      expect(preElement?.textContent).toContain('http://localhost:8001/mcp')
    })
  })

  describe('config generation', () => {
    // Helper to get the JSON config block (the one inside the <pre> tag)
    const getConfigText = (): string => {
      const preElement = document.querySelector('pre code')
      return preElement?.textContent || ''
    }

    it('should generate config with bookmarks_notes for content server', () => {
      renderWithRouter()

      const configText = getConfigText()

      expect(configText).toContain('bookmarks_notes')
      expect(configText).toContain('http://localhost:8001/mcp')
      expect(configText).not.toContain('"prompts"')
    })

    it('should generate config with prompts for prompt server', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      const configText = getConfigText()

      expect(configText).toContain('"prompts"')
      expect(configText).toContain('http://localhost:8002/mcp')
      expect(configText).not.toContain('bookmarks_notes')
    })

    it('should always use YOUR_TOKEN_HERE placeholder', () => {
      renderWithRouter()

      const configText = getConfigText()

      expect(configText).toContain('YOUR_TOKEN_HERE')
    })
  })

  describe('Claude Code config generation', () => {
    it('should generate correct command for content server', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Claude Code' }))

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('claude mcp add --transport http bookmarks')
      expect(preElement?.textContent).toContain('http://localhost:8001/mcp')
    })

    it('should generate correct command for prompt server', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Claude Code' }))
      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('claude mcp add --transport http prompts')
      expect(preElement?.textContent).toContain('http://localhost:8002/mcp')
    })

    it('should show import from Claude Desktop option', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Claude Code' }))

      expect(screen.getByText('Alternative: Import from Claude Desktop')).toBeInTheDocument()
      expect(screen.getByText('claude mcp add-from-claude-desktop')).toBeInTheDocument()
    })
  })

  describe('Codex config generation', () => {
    it('should generate correct config for content server', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('[mcp_servers.bookmarks]')
      expect(preElement?.textContent).toContain('http://localhost:8001/mcp')
    })

    it('should generate correct config for prompt server', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))
      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      const preElement = document.querySelector('pre code')
      expect(preElement?.textContent).toContain('[mcp_servers.prompts]')
      expect(preElement?.textContent).toContain('http://localhost:8002/mcp')
    })

    it('should show prompts usage note when prompts server selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))
      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      expect(screen.getByText('Using Your Prompts')).toBeInTheDocument()
      expect(screen.getByText(/Codex does not support MCP Prompts directly/)).toBeInTheDocument()
    })

    it('should not show prompts usage note when content server selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))

      expect(screen.queryByText('Using Your Prompts')).not.toBeInTheDocument()
    })
  })

  describe('copy functionality', () => {
    it('should show "Copied!" after clicking macOS path copy button', async () => {
      renderWithRouter()

      const copyButtons = screen.getAllByText('Copy')
      fireEvent.click(copyButtons[0]) // First copy button is for macOS path

      await waitFor(() => {
        expect(screen.getAllByText('Copied!').length).toBeGreaterThan(0)
      })
    })

    it('should show "Copied!" after clicking config copy button', async () => {
      renderWithRouter()

      const copyButtons = screen.getAllByText('Copy')
      fireEvent.click(copyButtons[2]) // Third copy button is for the config

      await waitFor(() => {
        expect(screen.getAllByText('Copied!').length).toBeGreaterThan(0)
      })
    })
  })

  describe('available tools section', () => {
    it('should show content server tools when content server selected', () => {
      renderWithRouter()

      expect(screen.getByText('Available MCP Tools')).toBeInTheDocument()
      // Tools appear twice (mobile + desktop views)
      expect(screen.getAllByText('search_items').length).toBeGreaterThan(0)
      expect(screen.getAllByText('get_item').length).toBeGreaterThan(0)
      expect(screen.getAllByText('create_bookmark').length).toBeGreaterThan(0)
      expect(screen.getAllByText('create_note').length).toBeGreaterThan(0)
    })

    it('should show prompt server tools when prompt server selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Prompts' }))

      expect(screen.getByText('Available MCP Tools')).toBeInTheDocument()
      // Tools appear twice (mobile + desktop views)
      expect(screen.getAllByText('search_prompts').length).toBeGreaterThan(0)
      expect(screen.getAllByText('get_prompt_content').length).toBeGreaterThan(0)
      expect(screen.getAllByText('create_prompt').length).toBeGreaterThan(0)
    })

    it('should not show available tools for unsupported clients', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Gemini CLI' }))

      expect(screen.queryByText('Available MCP Tools')).not.toBeInTheDocument()
    })

    it('should show available tools for Codex', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Codex' }))

      expect(screen.getByText('Available MCP Tools')).toBeInTheDocument()
    })
  })

  describe('links', () => {
    it('should have link to create token page', () => {
      renderWithRouter()

      const createTokenLink = screen.getByRole('link', { name: /create token/i })
      expect(createTokenLink).toHaveAttribute('href', '/app/settings/tokens')
    })

    it('should have link to MCP documentation', () => {
      renderWithRouter()

      const mcpLink = screen.getByRole('link', { name: /model context protocol/i })
      expect(mcpLink).toHaveAttribute('href', 'https://modelcontextprotocol.io/')
      expect(mcpLink).toHaveAttribute('target', '_blank')
    })
  })

  describe('add both servers tip', () => {
    it('should show tip about adding both servers for Claude Desktop', () => {
      renderWithRouter()

      expect(screen.getByText('Want to add both servers?')).toBeInTheDocument()
    })

    it('should show tip about adding both servers for Claude Code', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getByRole('button', { name: 'Claude Code' }))

      expect(screen.getByText('Want to add both servers?')).toBeInTheDocument()
    })
  })
})
