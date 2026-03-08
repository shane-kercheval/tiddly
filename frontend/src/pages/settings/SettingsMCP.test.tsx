/**
 * Tests for SettingsMCP settings page.
 *
 * Tests both the CLI setup section (default tab) and the manual setup section (Curl/PAT tab).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SettingsMCP } from './SettingsMCP'

// Mock config
vi.mock('../../config', () => ({
  config: {
    apiUrl: 'http://localhost:8000',
    mcpUrl: 'http://localhost:8001',
    promptMcpUrl: 'http://localhost:8002',
  },
}))

// Mock API service for tags endpoint
const mockApiGet = vi.fn()
vi.mock('../../services/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}))

// Mock tags store
vi.mock('../../stores/tagsStore', () => ({
  useTagsStore: () => ({
    tags: [
      { name: 'skill', content_count: 5, filter_count: 0 },
      { name: 'coding', content_count: 3, filter_count: 0 },
    ],
    fetchTags: vi.fn(),
    isLoading: false,
    error: null,
  }),
}))

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined)

beforeAll(() => {
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

/** Switch to manual setup tab and return the manual section container. */
async function openManualSection(): Promise<HTMLElement> {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Setup via Curl/PAT' }))
  return screen.getByTestId('manual-setup-section')
}

describe('SettingsMCP', () => {
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

  describe('page rendering', () => {
    it('should render page title', () => {
      renderWithRouter()
      expect(screen.getByText('AI Integration')).toBeInTheDocument()
    })

    it('should render tab buttons', () => {
      renderWithRouter()
      expect(screen.getByRole('button', { name: 'Setup via CLI (Recommended)' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Setup via Curl/PAT' })).toBeInTheDocument()
    })

    it('should show CLI section by default', () => {
      renderWithRouter()
      expect(screen.getByTestId('cli-setup-section')).toBeInTheDocument()
      expect(screen.queryByTestId('manual-setup-section')).not.toBeInTheDocument()
    })

    it('should switch to manual section when tab clicked', async () => {
      renderWithRouter()
      await openManualSection()
      expect(screen.getByTestId('manual-setup-section')).toBeInTheDocument()
      expect(screen.queryByTestId('cli-setup-section')).not.toBeInTheDocument()
    })
  })

  // ===========================================================================
  // CLI Setup Section
  // ===========================================================================
  describe('CLI setup section', () => {
    it('should render "what to install" toggles', () => {
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')
      expect(within(cli).getByText('MCP Servers')).toBeInTheDocument()
      expect(within(cli).getByText('Skills')).toBeInTheDocument()
      expect(within(cli).getByRole('button', { name: 'Bookmarks & Notes' })).toBeInTheDocument()
      expect(within(cli).getByRole('button', { name: 'Prompts' })).toBeInTheDocument()
      // Skills Yes/No toggle
      expect(within(cli).getByRole('button', { name: 'Yes' })).toBeInTheDocument()
      expect(within(cli).getByRole('button', { name: 'No' })).toBeInTheDocument()
    })

    it('should render "where to install" tool toggles', () => {
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')
      expect(within(cli).getByRole('button', { name: 'Claude Desktop' })).toBeInTheDocument()
      expect(within(cli).getByRole('button', { name: 'Claude Code' })).toBeInTheDocument()
      expect(within(cli).getByRole('button', { name: 'Codex' })).toBeInTheDocument()
    })

    it('should have servers and tools selected by default with skills off', () => {
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')
      // Server and tool pills should be selected (orange), except Claude Desktop
      for (const name of ['Bookmarks & Notes', 'Prompts', 'Claude Code', 'Codex']) {
        expect(within(cli).getByRole('button', { name }).className).toContain('bg-[#f09040]')
      }
      // Claude Desktop should be off by default
      expect(within(cli).getByRole('button', { name: 'Claude Desktop' }).className).not.toContain('bg-[#f09040]')
      // Skills should default to No
      expect(within(cli).getByRole('button', { name: 'No' }).className).toContain('bg-[#f09040]')
      expect(within(cli).getByRole('button', { name: 'Yes' }).className).not.toContain('bg-[#f09040]')
    })

    it('should generate default command with mcp only (skills off, Claude Desktop off)', () => {
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')
      const pre = within(cli).getByTestId('cli-install-command')
      expect(pre.textContent).toContain('tiddly mcp configure claude-code codex')
      expect(pre.textContent).not.toContain('tiddly skills configure')
    })

    it('should add skills command when skills enabled', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      await user.click(within(cli).getByRole('button', { name: 'Yes' }))

      const pre = within(cli).getByTestId('cli-install-command')
      expect(pre.textContent).toContain('tiddly mcp configure')
      expect(pre.textContent).toContain('tiddly skills configure')
    })

    it('should omit mcp command when no servers selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      // Enable skills first, then deselect both servers
      await user.click(within(cli).getByRole('button', { name: 'Yes' }))
      await user.click(within(cli).getByRole('button', { name: 'Bookmarks & Notes' }))
      await user.click(within(cli).getByRole('button', { name: 'Prompts' }))

      const pre = within(cli).getByTestId('cli-install-command')
      expect(pre.textContent).not.toContain('tiddly mcp configure')
      expect(pre.textContent).toContain('tiddly skills configure')
    })

    it('should omit skills command when skills set to No', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      // Enable then disable skills
      await user.click(within(cli).getByRole('button', { name: 'Yes' }))
      await user.click(within(cli).getByRole('button', { name: 'No' }))

      const pre = within(cli).getByTestId('cli-install-command')
      expect(pre.textContent).toContain('tiddly mcp configure')
      expect(pre.textContent).not.toContain('tiddly skills configure')
    })

    it('should add --servers flag when only one server selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      await user.click(within(cli).getByRole('button', { name: 'Prompts' }))

      const pre = within(cli).getByTestId('cli-install-command')
      expect(pre.textContent).toContain('--servers content')
    })

    it('should add tool names when not all tools selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      // Codex is on by default; deselect it so only claude-code remains
      await user.click(within(cli).getByRole('button', { name: 'Codex' }))

      const pre = within(cli).getByTestId('cli-install-command')
      expect(pre.textContent).toContain('tiddly mcp configure claude-code')
      expect(pre.textContent).not.toContain('codex')
    })

    it('should show empty state when nothing selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      // Deselect all servers (skills already off by default)
      await user.click(within(cli).getByRole('button', { name: 'Bookmarks & Notes' }))
      await user.click(within(cli).getByRole('button', { name: 'Prompts' }))

      expect(within(cli).getByText(/Select at least one item and one target tool above/)).toBeInTheDocument()
    })

    it('should show numbered steps with install, login, and command', () => {
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')
      expect(within(cli).getByText('Install the CLI')).toBeInTheDocument()
      expect(within(cli).getByText('Log in')).toBeInTheDocument()
      expect(within(cli).getByText('Install your integrations')).toBeInTheDocument()
      expect(within(cli).getByText('tiddly login')).toBeInTheDocument()
      expect(within(cli).getByRole('link', { name: /CLI docs/ })).toHaveAttribute('href', '/docs/cli')
    })

    describe('scope options', () => {
      it('should show MCP scope when servers selected', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        expect(within(cli).getByText('MCP Scope')).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'User (global)' })).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'Local' })).toBeInTheDocument()
        // "Project" appears in both MCP Scope and Skills Scope
        expect(within(cli).getAllByRole('button', { name: 'Project' }).length).toBeGreaterThanOrEqual(1)
      })

      it('should show Skills scope when skills enabled', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Yes' }))

        expect(within(cli).getByText('Skills Scope')).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'Global' })).toBeInTheDocument()
      })

      it('should hide MCP scope when no servers selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Bookmarks & Notes' }))
        await user.click(within(cli).getByRole('button', { name: 'Prompts' }))

        expect(within(cli).queryByText('MCP Scope')).not.toBeInTheDocument()
      })

      it('should hide Skills scope when skills off', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        // Skills default to No, so Skills Scope should not appear
        expect(within(cli).queryByText('Skills Scope')).not.toBeInTheDocument()
      })

      it('should add --scope to command when non-default scope selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Local' }))

        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('--scope local')
      })

      it('should show warning when scope not supported by selected tool', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Local' }))

        // Claude Desktop is off by default, so only Codex warning shows
        expect(within(cli).queryByText(/Claude Desktop doesn't support "local" scope/)).not.toBeInTheDocument()
        expect(within(cli).getByText(/Codex doesn't support "local" scope/)).toBeInTheDocument()
      })

      it('should not show warning for user scope (all tools support it)', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        expect(within(cli).queryByText(/doesn't support/)).not.toBeInTheDocument()
      })
    })

    describe('skills tag filter', () => {
      it('should show tag filter when skills enabled', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Yes' }))

        expect(within(cli).getByText(/Filter which prompts to export/)).toBeInTheDocument()
      })

      it('should hide tag filter when skills off', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        expect(within(cli).queryByText(/Filter which prompts to export/)).not.toBeInTheDocument()
      })

      it('should fetch prompt tags on mount', async () => {
        renderWithRouter()
        await waitFor(() => {
          expect(mockApiGet).toHaveBeenCalledWith('/tags/?content_types=prompt')
        })
      })

      it('should auto-select "skill" tag when it exists and skills enabled', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Yes' }))

        await waitFor(() => {
          expect(within(cli).getByText('skill')).toBeInTheDocument()
        })
      })

      it('should auto-select "skills" tag when "skill" does not exist', async () => {
        mockApiGet.mockResolvedValue({
          data: {
            tags: [
              { name: 'skills', content_count: 5, filter_count: 0 },
              { name: 'other', content_count: 3, filter_count: 0 },
            ],
          },
        })
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Yes' }))

        await waitFor(() => {
          expect(within(cli).getByText('skills')).toBeInTheDocument()
        })
      })

      it('should show tag match selector when skills enabled', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Yes' }))

        expect(within(cli).getByText('Match')).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'All tags' })).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'Any tag' })).toBeInTheDocument()
      })

      it('should add --tag-match any to command when any tag match selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        // Enable skills first
        await user.click(within(cli).getByRole('button', { name: 'Yes' }))
        await user.click(within(cli).getByRole('button', { name: 'Any tag' }))

        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('--tag-match any')
      })
    })

    describe('copy functionality', () => {
      it('should show Copied! after clicking copy button', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        const copyButtons = within(cli).getAllByText('Copy')
        await user.click(copyButtons[0])

        await waitFor(() => {
          expect(within(cli).getAllByText('Copied!').length).toBeGreaterThan(0)
        })
      })
    })
  })

  // ===========================================================================
  // Manual Setup Section (Curl/PAT tab)
  // ===========================================================================
  describe('manual setup section', () => {
    it('should not be visible on default CLI tab', () => {
      renderWithRouter()
      expect(screen.queryByTestId('manual-setup-section')).not.toBeInTheDocument()
    })

    it('should show when Curl/PAT tab clicked', async () => {
      renderWithRouter()
      const manual = await openManualSection()
      expect(manual).toBeInTheDocument()
      expect(within(manual).getByText('Select Integration')).toBeInTheDocument()
    })

    describe('selector rows', () => {
      it('should render all selector row labels', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        expect(within(manual).getByText('Content')).toBeInTheDocument()
        expect(within(manual).getByText('Client')).toBeInTheDocument()
        expect(within(manual).getByText('Auth')).toBeInTheDocument()
        expect(within(manual).getByText('Integration')).toBeInTheDocument()
      })

      it('should render integration options', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        expect(within(manual).getByRole('button', { name: 'MCP Server' })).toBeInTheDocument()
        expect(within(manual).getByRole('button', { name: 'Skills' })).toBeInTheDocument()
      })

      it('should render client options', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        expect(within(manual).getByRole('button', { name: 'Claude Desktop' })).toBeInTheDocument()
        expect(within(manual).getByRole('button', { name: 'Claude Code' })).toBeInTheDocument()
        expect(within(manual).getByRole('button', { name: 'Gemini CLI' })).toBeInTheDocument()
        expect(within(manual).getByRole('button', { name: 'ChatGPT' })).toBeInTheDocument()
        expect(within(manual).getByRole('button', { name: 'Codex' })).toBeInTheDocument()
      })

      it('should render auth options', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        expect(within(manual).getByRole('button', { name: 'Bearer Token' })).toBeInTheDocument()
        expect(within(manual).getByRole('button', { name: 'OAuth' })).toBeInTheDocument()
      })
    })

    describe('MCP instructions', () => {
      it('should show What is MCP section when MCP is selected', async () => {
        renderWithRouter()
        const manual = await openManualSection()
        expect(within(manual).getByText('What is MCP?')).toBeInTheDocument()
      })

      it('should show Claude Desktop instructions by default', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        expect(within(manual).getByText('Locate Config File')).toBeInTheDocument()
        expect(within(manual).getByText(/macOS:/)).toBeInTheDocument()
        expect(within(manual).getByText(/Windows:/)).toBeInTheDocument()
      })

      it('should generate config with tiddly_notes_bookmarks for content server', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        const preElement = manual.querySelector('pre code')
        expect(preElement?.textContent).toContain('tiddly_notes_bookmarks')
        expect(preElement?.textContent).toContain('http://localhost:8001/mcp')
      })

      it('should show Claude Code instructions when Claude Code is selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Claude Code' }))

        expect(within(manual).getByText('Add MCP Server')).toBeInTheDocument()
        const preElement = manual.querySelector('pre code')
        expect(preElement?.textContent).toContain('claude mcp add --transport http tiddly_notes_bookmarks')
      })

      it('should show Claude Code import from desktop option', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Claude Code' }))

        expect(within(manual).getByText('Alternative: Import from Claude Desktop')).toBeInTheDocument()
        expect(within(manual).getByText('claude mcp add-from-claude-desktop')).toBeInTheDocument()
      })

      it('should show Codex instructions when Codex is selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Codex' }))

        expect(within(manual).getByText('Add to Config File')).toBeInTheDocument()
        expect(within(manual).getByText(/~\/\.codex\/config\.toml/)).toBeInTheDocument()
      })

      it('should show prompt server config when Prompts is selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Prompts' }))

        const preElement = manual.querySelector('pre code')
        expect(preElement?.textContent).toContain('"tiddly_prompts"')
        expect(preElement?.textContent).toContain('http://localhost:8002/mcp')
      })
    })

    describe('coming soon features', () => {
      it('should show coming soon for ChatGPT', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'ChatGPT' }))

        expect(within(manual).getByText('ChatGPT Integration Coming Soon')).toBeInTheDocument()
      })

      it('should show coming soon for OAuth', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'OAuth' }))

        expect(within(manual).getByText('OAuth Coming Soon')).toBeInTheDocument()
      })

      it('should show skills not applicable for Bookmarks & Notes', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Skills' }))
        await user.click(within(manual).getByRole('button', { name: 'Bookmarks & Notes' }))

        expect(within(manual).getByText('Skills Only Apply to Prompts')).toBeInTheDocument()
      })
    })

    describe('skills export', () => {
      it('should show skills export section when Skills + Prompts selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Skills' }))

        expect(within(manual).getByText('Filter by Tags (Optional)')).toBeInTheDocument()
      })

      it('should show What are Skills section', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Skills' }))

        expect(within(manual).getByText('What are Skills?')).toBeInTheDocument()
      })
    })

    describe('available tools', () => {
      it('should show content tools for content server', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        expect(within(manual).getByText('Available MCP Tools')).toBeInTheDocument()
        expect(within(manual).getAllByText('search_items').length).toBeGreaterThan(0)
        expect(within(manual).getAllByText('create_bookmark').length).toBeGreaterThan(0)
      })

      it('should show prompt tools for prompt server', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Prompts' }))

        expect(within(manual).getAllByText('search_prompts').length).toBeGreaterThan(0)
        expect(within(manual).getAllByText('create_prompt').length).toBeGreaterThan(0)
      })

      it('should not show tools for unsupported clients', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Gemini CLI' }))

        expect(within(manual).queryByText('Available MCP Tools')).not.toBeInTheDocument()
      })
    })

    describe('links', () => {
      it('should have link to create token page', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        const createTokenLink = within(manual).getByRole('link', { name: /create token/i })
        expect(createTokenLink).toHaveAttribute('href', '/app/settings/tokens')
      })

      it('should have link to MCP documentation', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        const mcpLink = within(manual).getByRole('link', { name: /model context protocol/i })
        expect(mcpLink).toHaveAttribute('href', 'https://modelcontextprotocol.io/')
        expect(mcpLink).toHaveAttribute('target', '_blank')
      })
    })

    describe('both servers tip', () => {
      it('should show tip for Claude Desktop', async () => {
        renderWithRouter()
        const manual = await openManualSection()
        expect(within(manual).getByText('Want to add both servers?')).toBeInTheDocument()
      })

      it('should show tip for Claude Code', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const manual = await openManualSection()

        await user.click(within(manual).getByRole('button', { name: 'Claude Code' }))

        expect(within(manual).getByText('Want to add both servers?')).toBeInTheDocument()
      })
    })

    describe('copy functionality', () => {
      it('should copy config when copy button clicked', async () => {
        renderWithRouter()
        const manual = await openManualSection()

        const copyButtons = within(manual).getAllByText('Copy')
        const user = userEvent.setup()
        await user.click(copyButtons[0])

        await waitFor(() => {
          expect(within(manual).getAllByText('Copied!').length).toBeGreaterThan(0)
        })
      })
    })
  })
})
