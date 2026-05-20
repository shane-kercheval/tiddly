/**
 * Tests for SettingsMCP settings page.
 *
 * Tests both the CLI setup section (default tab) and the manual setup section (Curl/PAT tab).
 *
 * For the tool/scope support matrix and terminology decisions,
 * see docs/ai-integration.md
 *
 * == Scope Model ==
 *
 * Single scope selector with two options: User and Directory.
 * Applies to both MCP and skills commands.
 * Claude Desktop only supports User scope — Directory scope shows error.
 *
 * == CLI Remove Flow: Scenario Matrix ==
 *
 * Scope:
 *   - Default scope           → "user", no --scope in command
 *   - Directory scope         → --scope directory in command, cd prepended
 *   - Claude Desktop only + directory → error, steps hidden
 *
 * Delete tokens:
 *   - Defaults to no          → no --delete-tokens, no login step
 *   - Enabled                 → --delete-tokens in command, login step shown
 *   - Skills only (no MCP)    → Delete Tokens option hidden
 *
 * --servers flag:
 *   - Both servers selected   → no --servers flag
 *   - One server selected     → --servers content or --servers prompts
 *
 * Skills removal:
 *   - Skills=yes in remove    → warning callout shown, commented-out rm -rf commands
 *   - Skills=yes in configure → no warning
 *   - Claude Desktop          → manual instruction (no rm command)
 *   - User scope              → ~/.claude/skills/, ~/.agents/skills/ (+ ~/.codex/skills/ deprecated)
 *   - Directory scope         → .claude/skills/, .agents/skills/
 *
 * cd step:
 *   - Directory scope         → cd /path/to/your/project prepended (both configure and remove)
 *   - User scope              → no cd line
 *
 * Command join (configure):
 *   - User scope + MCP+skills → commands joined with && (stop on failure)
 *   - Directory + MCP+skills  → commands joined with \n (cd on separate line)
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

    it('should render the CLI setup section (no tabs, manual setup removed)', () => {
      renderWithRouter()
      expect(screen.getByRole('heading', { name: 'Setup via CLI' })).toBeInTheDocument()
      expect(screen.getByTestId('cli-setup-section')).toBeInTheDocument()
      // The old Curl/PAT manual tab is gone.
      expect(screen.queryByRole('button', { name: 'Setup via Curl/PAT' })).not.toBeInTheDocument()
      expect(screen.queryByTestId('manual-setup-section')).not.toBeInTheDocument()
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
      expect(within(cli).getByRole('button', { name: 'Antigravity' })).toBeInTheDocument()
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

    // Intentional asymmetry: when ALL tools are selected the command omits tool
    // names and emits bare `tiddly mcp configure`, which auto-detects *installed*
    // tools and gracefully skips ones that aren't present. A PARTIAL selection
    // (the test above) names tools explicitly, which is strict — `tiddly mcp
    // configure <uninstalled-tool>` errors. So "select everything" maps to the
    // forgiving auto-detect path on purpose, not by accident.
    it('should emit bare auto-detect command when all tools selected', async () => {
      const user = userEvent.setup()
      renderWithRouter()
      const cli = screen.getByTestId('cli-setup-section')

      // Defaults are claude-code + codex; add the remaining two to select all four.
      await user.click(within(cli).getByRole('button', { name: 'Claude Desktop' }))
      await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))

      const pre = within(cli).getByTestId('cli-install-command')
      const mcpLine = (pre.textContent || '').split('\n').find((l) => l.includes('tiddly mcp configure')) || ''
      expect(mcpLine).toContain('tiddly mcp configure')
      for (const name of ['claude-desktop', 'claude-code', 'codex', 'antigravity']) {
        expect(mcpLine).not.toContain(name)
      }
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
      it('should show single Scope selector with User and Directory options', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        expect(within(cli).getByText('Scope')).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'User' })).toBeInTheDocument()
        expect(within(cli).getByRole('button', { name: 'Directory' })).toBeInTheDocument()
        // Old labels should not exist
        expect(within(cli).queryByText('MCP Scope')).not.toBeInTheDocument()
        expect(within(cli).queryByText('Skills Scope')).not.toBeInTheDocument()
        expect(within(cli).queryByRole('button', { name: 'User (global)' })).not.toBeInTheDocument()
        expect(within(cli).queryByRole('button', { name: 'Local' })).not.toBeInTheDocument()
        expect(within(cli).queryByRole('button', { name: 'Global' })).not.toBeInTheDocument()
      })

      it('should hide scope when nothing selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Bookmarks & Notes' }))
        await user.click(within(cli).getByRole('button', { name: 'Prompts' }))

        expect(within(cli).queryByText('Scope')).not.toBeInTheDocument()
      })

      it('should add --scope directory to command when Directory selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Directory' }))

        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('--scope directory')
      })

      it('should not add --scope when User selected (default)', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).not.toContain('--scope')
      })

      it('should apply scope to both MCP and skills commands', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Yes' }))
        await user.click(within(cli).getByRole('button', { name: 'Directory' }))

        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('tiddly mcp configure')
        expect(pre.textContent).toContain('tiddly skills configure')
        // Both commands should have --scope directory
        const text = pre.textContent || ''
        const mcpMatch = text.match(/tiddly mcp configure[^\n]*--scope directory/)
        const skillsMatch = text.match(/tiddly skills configure[^\n]*--scope directory/)
        expect(mcpMatch).not.toBeNull()
        expect(skillsMatch).not.toBeNull()
      })

      it('should not show scope warnings', () => {
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')
        expect(within(cli).queryByText(/doesn't support/)).not.toBeInTheDocument()
      })
    })

    describe('antigravity', () => {
      it('should add antigravity to the configure command when selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))

        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('antigravity')
      })

      it('should show user-scope-only error when antigravity selected with Directory scope', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))
        await user.click(within(cli).getByRole('button', { name: 'Directory' }))

        expect(within(cli).getByText(/only support.*User scope/)).toBeInTheDocument()
        // No command is offered while the conflict stands.
        expect(within(cli).queryByTestId('cli-install-command')).not.toBeInTheDocument()
      })

      it('should not be affected by the Skills toggle on its own (no skills, no error when skills off)', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        // Select only Antigravity (deselect the two defaults).
        await user.click(within(cli).getByRole('button', { name: 'Claude Code' }))
        await user.click(within(cli).getByRole('button', { name: 'Codex' }))
        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))

        // Skills off (default): just the configure command, no skills, no error.
        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('tiddly mcp configure antigravity')
        expect(pre.textContent).not.toContain('tiddly skills configure')
        expect(within(cli).queryByText(/does not support skills/)).not.toBeInTheDocument()
      })
    })

    describe('skills support conflict', () => {
      it('should error when skills enabled with only Antigravity selected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Claude Code' }))
        await user.click(within(cli).getByRole('button', { name: 'Codex' }))
        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))
        await user.click(within(cli).getByRole('button', { name: 'Yes' })) // enable skills

        expect(within(cli).getByText('Antigravity does not support skills. Deselect it or turn off Skills.')).toBeInTheDocument()
        // The conflict blocks the command entirely (mirrors the scope conflict).
        expect(within(cli).queryByTestId('cli-install-command')).not.toBeInTheDocument()
      })

      it('should error when skills enabled and Antigravity is selected alongside skills-capable tools', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        // Defaults claude-code + codex (skills-capable) plus Antigravity.
        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))
        await user.click(within(cli).getByRole('button', { name: 'Yes' })) // enable skills

        expect(within(cli).getByText('Antigravity does not support skills. Deselect it or turn off Skills.')).toBeInTheDocument()
        expect(within(cli).queryByTestId('cli-install-command')).not.toBeInTheDocument()
      })

      it('should clear the skills conflict when Skills is turned off', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))
        await user.click(within(cli).getByRole('button', { name: 'Yes' })) // enable skills → conflict
        expect(within(cli).getByText(/does not support skills/)).toBeInTheDocument()

        await user.click(within(cli).getByRole('button', { name: 'No' })) // disable skills → resolved
        expect(within(cli).queryByText(/does not support skills/)).not.toBeInTheDocument()
        expect(within(cli).getByTestId('cli-install-command').textContent).toContain('tiddly mcp configure')
      })

      it('should clear the skills conflict when the unsupported tool is deselected', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))
        await user.click(within(cli).getByRole('button', { name: 'Yes' })) // conflict
        expect(within(cli).getByText(/does not support skills/)).toBeInTheDocument()

        await user.click(within(cli).getByRole('button', { name: 'Antigravity' })) // deselect → resolved
        expect(within(cli).queryByText(/does not support skills/)).not.toBeInTheDocument()
        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('tiddly skills configure')
      })

      it('should show both scope and skills conflicts together', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        await user.click(within(cli).getByRole('button', { name: 'Antigravity' }))
        await user.click(within(cli).getByRole('button', { name: 'Yes' }))       // skills conflict
        await user.click(within(cli).getByRole('button', { name: 'Directory' })) // scope conflict

        expect(within(cli).getByText(/only support.*User scope/)).toBeInTheDocument()
        expect(within(cli).getByText(/does not support skills/)).toBeInTheDocument()
        expect(within(cli).queryByTestId('cli-install-command')).not.toBeInTheDocument()
      })

      it('should not error when skills enabled with only skills-capable tools', async () => {
        const user = userEvent.setup()
        renderWithRouter()
        const cli = screen.getByTestId('cli-setup-section')

        // Defaults claude-code + codex are both skills-capable.
        await user.click(within(cli).getByRole('button', { name: 'Yes' })) // enable skills

        expect(within(cli).queryByText(/does not support skills/)).not.toBeInTheDocument()
        const pre = within(cli).getByTestId('cli-install-command')
        expect(pre.textContent).toContain('tiddly skills configure')
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

})
