/**
 * Tests for SettingsMCP settings page.
 *
 * Tests MCP server configuration generation and toggle functionality.
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

      expect(screen.getByText('MCP Integration')).toBeInTheDocument()
    })

    it('should render What is MCP section', () => {
      renderWithRouter()

      expect(screen.getByText('What is MCP?')).toBeInTheDocument()
    })

    it('should render setup instructions', () => {
      renderWithRouter()

      expect(screen.getByText('Setup Instructions')).toBeInTheDocument()
    })

    it('should render server selection cards', () => {
      renderWithRouter()

      expect(screen.getByText('Content MCP Server')).toBeInTheDocument()
      expect(screen.getByText('Prompt MCP Server')).toBeInTheDocument()
    })
  })

  describe('server toggles', () => {
    it('should have both servers enabled by default', () => {
      renderWithRouter()

      const switches = screen.getAllByRole('switch')
      expect(switches[0]).toHaveAttribute('aria-checked', 'true') // Content server
      expect(switches[1]).toHaveAttribute('aria-checked', 'true') // Prompt server
    })

    it('should toggle content server when switch is clicked', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      const contentSwitch = screen.getAllByRole('switch')[0]
      await user.click(contentSwitch)

      expect(contentSwitch).toHaveAttribute('aria-checked', 'false')
    })

    it('should toggle prompt server when switch is clicked', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      const promptSwitch = screen.getAllByRole('switch')[1]
      await user.click(promptSwitch)

      expect(promptSwitch).toHaveAttribute('aria-checked', 'false')
    })

    it('should toggle server when card is clicked', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      // Click the content server card
      await user.click(screen.getByText('Content MCP Server'))

      const contentSwitch = screen.getAllByRole('switch')[0]
      expect(contentSwitch).toHaveAttribute('aria-checked', 'false')
    })

    it('should show warning when no servers selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      // Disable both servers
      await user.click(screen.getAllByRole('switch')[0])
      await user.click(screen.getAllByRole('switch')[1])

      expect(screen.getByText('Select at least one server to generate a configuration.')).toBeInTheDocument()
    })
  })

  describe('config generation', () => {
    // Helper to get the JSON config block (the one inside the <pre> tag)
    const getConfigText = (): string => {
      const preElement = document.querySelector('pre code')
      return preElement?.textContent || ''
    }

    it('should generate config with both servers when both enabled', () => {
      renderWithRouter()

      const configText = getConfigText()

      expect(configText).toContain('bookmarks_notes')
      expect(configText).toContain('prompts')
      expect(configText).toContain('http://localhost:8001/mcp')
      expect(configText).toContain('http://localhost:8002/mcp')
    })

    it('should generate config with only content server when prompt disabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      // Disable prompt server
      await user.click(screen.getAllByRole('switch')[1])

      const configText = getConfigText()

      expect(configText).toContain('bookmarks_notes')
      expect(configText).not.toContain('"prompts"')
      expect(configText).toContain('http://localhost:8001/mcp')
    })

    it('should generate config with only prompt server when content disabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      // Disable content server
      await user.click(screen.getAllByRole('switch')[0])

      const configText = getConfigText()

      expect(configText).not.toContain('bookmarks_notes')
      expect(configText).toContain('"prompts"')
      expect(configText).toContain('http://localhost:8002/mcp')
    })

    it('should use separate token placeholders when both servers enabled', () => {
      renderWithRouter()

      const configText = getConfigText()

      expect(configText).toContain('YOUR_BOOKMARKS_TOKEN')
      expect(configText).toContain('YOUR_PROMPTS_TOKEN')
    })

    it('should use single token placeholder when only one server enabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      // Disable prompt server
      await user.click(screen.getAllByRole('switch')[1])

      const configText = getConfigText()

      expect(configText).toContain('YOUR_TOKEN_HERE')
      expect(configText).not.toContain('YOUR_BOOKMARKS_TOKEN')
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

    it('should show "Copied!" after clicking Windows path copy button', async () => {
      renderWithRouter()

      const copyButtons = screen.getAllByText('Copy')
      fireEvent.click(copyButtons[1]) // Second copy button is for Windows path

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

  describe('separate tokens tip', () => {
    it('should show tip about separate tokens when both servers enabled', () => {
      renderWithRouter()

      expect(screen.getByText(/consider creating separate tokens for each/i)).toBeInTheDocument()
    })

    it('should not show tip when only one server enabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getAllByRole('switch')[1]) // Disable prompt server

      expect(screen.queryByText(/consider creating separate tokens for each/i)).not.toBeInTheDocument()
    })
  })

  describe('available tools section', () => {
    it('should show content server tools when enabled', () => {
      renderWithRouter()

      expect(screen.getByText('search_bookmarks')).toBeInTheDocument()
      expect(screen.getByText('get_bookmark')).toBeInTheDocument()
      expect(screen.getByText('create_bookmark')).toBeInTheDocument()
      expect(screen.getByText('search_notes')).toBeInTheDocument()
    })

    it('should show prompt server tools when enabled', () => {
      renderWithRouter()

      expect(screen.getByText('list_prompts')).toBeInTheDocument()
      expect(screen.getByText('get_prompt')).toBeInTheDocument()
      expect(screen.getByText('create_prompt')).toBeInTheDocument()
    })

    it('should hide content tools when content server disabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getAllByRole('switch')[0]) // Disable content server

      expect(screen.queryByText('search_bookmarks')).not.toBeInTheDocument()
      expect(screen.queryByText('search_notes')).not.toBeInTheDocument()
    })

    it('should hide prompt tools when prompt server disabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()

      await user.click(screen.getAllByRole('switch')[1]) // Disable prompt server

      expect(screen.queryByText('list_prompts')).not.toBeInTheDocument()
      expect(screen.queryByText('get_prompt')).not.toBeInTheDocument()
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
})
