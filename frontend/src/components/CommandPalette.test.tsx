/**
 * Tests for CommandPalette command list composition.
 *
 * Verifies that non-navigable builtins (e.g. command-palette) are excluded
 * from the command list while navigable builtins and filters appear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// Mock stores before importing CommandPalette

let mockContentQueryData: { items: Array<Record<string, unknown>>; total: number } | null = null
vi.mock('../hooks/useContentQuery', () => ({
  useContentQuery: () => ({ data: mockContentQueryData, isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('../hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: string) => value,
}))

vi.mock('../stores/tagFilterStore', () => ({
  useTagFilterStore: () => ({
    getSelectedTags: () => [],
    getTagMatch: () => 'all',
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setTagMatch: vi.fn(),
    clearFilters: vi.fn(),
  }),
}))

vi.mock('../stores/uiPreferencesStore', () => ({
  useUIPreferencesStore: () => ({
    pageSize: 25,
    setPageSize: vi.fn(),
    getSortOverride: () => undefined,
    setSortOverride: vi.fn(),
    clearSortOverride: vi.fn(),
    getViewFilters: () => ['active'],
    toggleViewFilter: vi.fn(),
    clearViewFilters: vi.fn(),
  }),
  DEFAULT_VIEW_FILTERS: ['active'],
  PAGE_SIZE_OPTIONS: [25, 50, 100],
}))

vi.mock('../stores/contentTypeFilterStore', () => ({
  useContentTypeFilterStore: () => ({
    getSelectedTypes: () => ['bookmark', 'note', 'prompt'],
    toggleType: vi.fn(),
    clearTypes: vi.fn(),
  }),
  ALL_CONTENT_TYPES: ['bookmark', 'note', 'prompt'],
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: () => ({ tags: [] }),
}))

vi.mock('../stores/sidebarStore', () => ({
  useSidebarStore: Object.assign(
    () => ({}),
    { getState: () => ({ closeMobile: vi.fn() }) },
  ),
}))

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      sidebar: {
        version: 1,
        items: [
          { type: 'builtin', key: 'command-palette', name: 'Command Palette' },
          { type: 'builtin', key: 'all', name: 'All Content' },
          { type: 'builtin', key: 'archived', name: 'Archived' },
          { type: 'filter', id: '10', name: 'My Filter', content_types: ['bookmark'] },
        ],
      },
    }
    return selector(state)
  },
}))

import { CommandPalette } from './CommandPalette'

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  return <MemoryRouter initialEntries={['/app/content']}>{children}</MemoryRouter>
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContentQueryData = null
  })

  describe('command list filtering', () => {
    it('excludes non-navigable builtins from command list', () => {
      render(
        <CommandPalette isOpen onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )

      // Navigable builtins should appear
      expect(screen.getByText('All Content')).toBeTruthy()
      expect(screen.getByText('Archived')).toBeTruthy()

      // Filter should appear (with "Filter:" prefix)
      expect(screen.getByText('Filter: My Filter')).toBeTruthy()

      // command-palette should NOT appear as a command
      const allOptions = screen.getAllByRole('option')
      const commandLabels = allOptions.map((el) => el.textContent)
      expect(commandLabels).not.toContain('Command Palette')
    })
  })

  describe('keyboard navigation', () => {
    it('first command is selected by default', () => {
      render(
        <CommandPalette isOpen onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )

      const options = screen.getAllByRole('option')
      // First command should have highlighted background
      expect(options[0].className).toContain('bg-gray-100')
    })

    it('ArrowDown moves selection to next command', async () => {
      const user = userEvent.setup()
      render(
        <CommandPalette isOpen onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Type a command...')
      await user.click(input)
      await user.keyboard('{ArrowDown}')

      const options = screen.getAllByRole('option')
      // Second command should now be highlighted
      expect(options[1].className).toContain('bg-gray-100')
      expect(options[0].className).not.toContain('bg-gray-100')
    })

    it('ArrowUp moves selection to previous command', async () => {
      const user = userEvent.setup()
      render(
        <CommandPalette isOpen onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Type a command...')
      await user.click(input)
      // Move down then back up
      await user.keyboard('{ArrowDown}{ArrowUp}')

      const options = screen.getAllByRole('option')
      expect(options[0].className).toContain('bg-gray-100')
    })

    it('Enter executes the selected command', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <CommandPalette isOpen onClose={onClose} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Type a command...')
      await user.click(input)
      // First command is "Search" which switches to search view
      await user.keyboard('{Enter}')

      // Should have switched to search view - search placeholder changes
      expect(screen.getByPlaceholderText('Search all content...')).toBeTruthy()
    })

    it('scrollIntoView is called when navigating', async () => {
      const user = userEvent.setup()
      render(
        <CommandPalette isOpen onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Type a command...')
      await user.click(input)
      await user.keyboard('{ArrowDown}')

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })

  })

  describe('search view keyboard navigation', () => {
    const mockSearchResults = {
      items: [
        { id: '1', type: 'bookmark', title: 'Bookmark One', url: 'https://example.com', description: '', tags: [], created_at: '2024-01-01', updated_at: '2024-01-01', last_used_at: null, deleted_at: null, archived_at: null, content_preview: null },
        { id: '2', type: 'note', title: 'Note Two', description: '', tags: [], created_at: '2024-01-01', updated_at: '2024-01-01', last_used_at: null, deleted_at: null, archived_at: null, version: 1, content_preview: null },
        { id: '3', type: 'prompt', name: 'prompt-three', title: 'Prompt Three', description: '', tags: [], arguments: [], created_at: '2024-01-01', updated_at: '2024-01-01', last_used_at: null, deleted_at: null, archived_at: null, content_preview: null },
      ],
      total: 3,
    }

    async function renderSearchView(): Promise<{ user: ReturnType<typeof userEvent.setup>; input: HTMLElement }> {
      const user = userEvent.setup()
      mockContentQueryData = mockSearchResults
      render(
        <CommandPalette isOpen initialView="search" onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )
      // Type a query to trigger search results rendering
      const input = screen.getByPlaceholderText('Search all content...')
      await user.type(input, 'test')
      return { user, input }
    }

    function getSearchOptions(): HTMLElement[] {
      const listbox = screen.getByRole('listbox')
      return Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[]
    }

    it('no item is selected initially', async () => {
      await renderSearchView()

      const options = getSearchOptions()
      expect(options).toHaveLength(3)
      options.forEach((opt) => {
        expect(opt.getAttribute('aria-selected')).toBe('false')
      })
    })

    it('ArrowDown from search input selects first result', async () => {
      const { user } = await renderSearchView()
      await user.keyboard('{ArrowDown}')

      const options = getSearchOptions()
      expect(options[0].getAttribute('aria-selected')).toBe('true')
      expect(options[1].getAttribute('aria-selected')).toBe('false')
    })

    it('ArrowDown/ArrowUp navigates between results', async () => {
      const { user } = await renderSearchView()
      await user.keyboard('{ArrowDown}{ArrowDown}')

      const options = getSearchOptions()
      expect(options[1].getAttribute('aria-selected')).toBe('true')

      await user.keyboard('{ArrowUp}')
      expect(options[0].getAttribute('aria-selected')).toBe('true')
    })

    it('ArrowUp on first result returns focus to search input', async () => {
      const { user, input } = await renderSearchView()
      await user.keyboard('{ArrowDown}{ArrowUp}')

      expect(document.activeElement).toBe(input)
    })

    it('Enter on selected bookmark opens URL in new tab and closes', async () => {
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const onClose = vi.fn()
      const user = userEvent.setup()
      mockContentQueryData = mockSearchResults
      render(
        <CommandPalette isOpen initialView="search" onClose={onClose} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Search all content...')
      await user.type(input, 'test')
      await user.keyboard('{ArrowDown}{Enter}')

      expect(windowOpenSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
      expect(onClose).toHaveBeenCalled()
      windowOpenSpy.mockRestore()
    })

    it('Enter on selected note navigates and closes', async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()
      mockContentQueryData = mockSearchResults
      render(
        <CommandPalette isOpen initialView="search" onClose={onClose} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Search all content...')
      await user.type(input, 'test')
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

      expect(mockNavigate).toHaveBeenCalledWith('/app/notes/2')
      expect(onClose).toHaveBeenCalled()
    })

    it('Enter on selected prompt navigates and closes', async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()
      mockContentQueryData = mockSearchResults
      render(
        <CommandPalette isOpen initialView="search" onClose={onClose} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Search all content...')
      await user.type(input, 'test')
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

      expect(mockNavigate).toHaveBeenCalledWith('/app/prompts/3')
      expect(onClose).toHaveBeenCalled()
    })

    it('Enter with no selection does nothing', async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()
      mockContentQueryData = mockSearchResults
      render(
        <CommandPalette isOpen initialView="search" onClose={onClose} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Search all content...')
      await user.type(input, 'test')
      await user.keyboard('{Enter}')

      // onClose should NOT have been called (Enter is no-op at index -1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('aria-activedescendant updates on search input when navigating', async () => {
      const { user, input } = await renderSearchView()

      // No selection initially
      expect(input.getAttribute('aria-activedescendant')).toBeNull()

      await user.keyboard('{ArrowDown}')
      expect(input.getAttribute('aria-activedescendant')).toBe('search-item-0')

      await user.keyboard('{ArrowDown}')
      expect(input.getAttribute('aria-activedescendant')).toBe('search-item-1')
    })

    it('scrollIntoView is called when navigating results', async () => {
      const { user } = await renderSearchView()
      await user.keyboard('{ArrowDown}')

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })
  })

  describe('tips integration (M8)', () => {
    // Tip-related assertions exercise the real `allTips` corpus, not a mock —
    // the integration we care about is "tips authored in M5 surface here." If
    // a referenced tip is ever removed from the corpus, the test will fail
    // visibly so we know to update it.

    function commandLabels(): string[] {
      return screen.getAllByRole('option').map((el) => el.textContent ?? '')
    }

    it('renders tip entries below the Settings group in the default (empty-query) view', () => {
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      const labels = commandLabels()
      // Tip entries exist at all and are placed after the last Settings: entry.
      const firstTipIndex = labels.findIndex((label) => label.startsWith('Tip:'))
      let lastSettingsIndex = -1
      for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].startsWith('Settings:')) { lastSettingsIndex = i; break }
      }
      expect(firstTipIndex).toBeGreaterThan(-1)
      expect(lastSettingsIndex).toBeGreaterThan(-1)
      expect(lastSettingsIndex).toBeLessThan(firstTipIndex)
    })

    it('surfaces a tip when the query matches the title', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      // Stable seed-tip title: "Open the command palette".
      await user.keyboard('command palette')
      const labels = commandLabels()
      expect(labels).toContain('Tip: Open the command palette')
    })

    it('surfaces a tip when the query matches only the body (not the title)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      // "filterable" appears in `editor-command-menu`'s body but not its title;
      // verifies `searchText` OR-matching against `label`.
      await user.keyboard('filterable')
      const labels = commandLabels()
      expect(labels.some((label) => label.startsWith('Tip:'))).toBe(true)
    })

    it('ranks non-tip commands above matching tips in the filtered list', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      // "search" matches the built-in "Search" command and several tip
      // titles/bodies (e.g. global-search-shortcut, search-quoted-phrase).
      await user.keyboard('search')
      const labels = commandLabels()
      const firstTipIndex = labels.findIndex((label) => label.startsWith('Tip:'))
      let lastNonTipIndex = -1
      for (let i = labels.length - 1; i >= 0; i--) {
        if (!labels[i].startsWith('Tip:')) { lastNonTipIndex = i; break }
      }
      expect(firstTipIndex).toBeGreaterThan(-1)
      expect(lastNonTipIndex).toBeGreaterThan(-1)
      expect(lastNonTipIndex).toBeLessThan(firstTipIndex)
    })

    it('selecting a tip opens the tip-detail sub-view; back returns to commands', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      await user.keyboard('command palette')
      await user.click(screen.getByText('Tip: Open the command palette'))

      // Tip-detail view: TipCard rendered with the tip's anchor DOM id, and a
      // Back affordance to leave the sub-view.
      expect(document.querySelector('#tip-palette-shortcut')).not.toBeNull()
      expect(screen.queryByPlaceholderText('Type a command...')).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Back to commands' }))
      // Back lands on the commands view (command input back, tip card gone).
      expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
      expect(document.querySelector('#tip-palette-shortcut')).toBeNull()
    })

    it('renders prev/next cycle buttons when the filtered list has multiple tips', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      // Open the palette with the default (empty-query) view — every tip is
      // listed, so the cycle has the full corpus to walk through.
      await user.click(screen.getAllByText(/^Tip:/)[0])
      expect(screen.getByRole('button', { name: 'Previous tip' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next tip' })).toBeInTheDocument()
    })

    it('Next cycles to the following tip; Previous cycles backward', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      const firstTipButton = screen.getAllByText(/^Tip:/)[0]
      const firstTipLabel = firstTipButton.textContent ?? ''
      await user.click(firstTipButton)

      // Capture the rendered tip's title (sits at h3) before cycling.
      const initialTitle = screen.getByRole('heading', { level: 3 }).textContent
      expect(`Tip: ${initialTitle}`).toBe(firstTipLabel)

      await user.click(screen.getByRole('button', { name: 'Next tip' }))
      const afterNext = screen.getByRole('heading', { level: 3 }).textContent
      expect(afterNext).not.toBe(initialTitle)

      await user.click(screen.getByRole('button', { name: 'Previous tip' }))
      const afterPrev = screen.getByRole('heading', { level: 3 }).textContent
      expect(afterPrev).toBe(initialTitle)
    })

    it('Previous from the first tip wraps to the last (and vice versa)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      const tipButtons = screen.getAllByText(/^Tip:/)
      const firstLabel = tipButtons[0].textContent ?? ''
      const lastLabel = tipButtons[tipButtons.length - 1].textContent ?? ''

      // Open the first tip, hit Previous — should wrap to the last tip.
      await user.click(tipButtons[0])
      expect(`Tip: ${screen.getByRole('heading', { level: 3 }).textContent}`).toBe(firstLabel)
      await user.click(screen.getByRole('button', { name: 'Previous tip' }))
      expect(`Tip: ${screen.getByRole('heading', { level: 3 }).textContent}`).toBe(lastLabel)

      // From the last tip, Next wraps back to the first.
      await user.click(screen.getByRole('button', { name: 'Next tip' }))
      expect(`Tip: ${screen.getByRole('heading', { level: 3 }).textContent}`).toBe(firstLabel)
    })

    it('surfaces a settings entry on a body-keyword match (no longer label-only)', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      // "mcp" appears only in the AI Integration settings entry's searchText
      // keyword soup — not in the literal label "Settings: AI Integration".
      // This is the original motivating case for adding searchText to settings.
      await user.keyboard('mcp')
      const labels = commandLabels()
      expect(labels).toContain('Settings: AI Integration')
    })

    it('ranks the matching settings entry above the matching docs entry for the same keyword', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      await user.keyboard('mcp')
      const labels = commandLabels()
      const settingsIndex = labels.indexOf('Settings: AI Integration')
      const docsIndex = labels.indexOf('Docs: AI Integration')
      expect(settingsIndex).toBeGreaterThan(-1)
      expect(docsIndex).toBeGreaterThan(-1)
      // Settings is the actionable place ("configure MCP here"), Docs is the
      // reference ("read about MCP"). Settings should rank first.
      expect(settingsIndex).toBeLessThan(docsIndex)
    })

    it('renders docs entries between Settings and Tips in the default view', () => {
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      const labels = commandLabels()
      let lastSettingsIndex = -1
      for (let i = labels.length - 1; i >= 0; i--) {
        if (labels[i].startsWith('Settings:')) { lastSettingsIndex = i; break }
      }
      const firstDocsIndex = labels.findIndex((label) => label.startsWith('Docs:'))
      const lastDocsIndex = (() => {
        for (let i = labels.length - 1; i >= 0; i--) {
          if (labels[i].startsWith('Docs:')) return i
        }
        return -1
      })()
      const firstTipIndex = labels.findIndex((label) => label.startsWith('Tip:'))
      // Settings → Docs → Tips ordering is load-bearing for the palette UX.
      expect(lastSettingsIndex).toBeGreaterThan(-1)
      expect(firstDocsIndex).toBeGreaterThan(-1)
      expect(lastDocsIndex).toBeGreaterThan(-1)
      expect(firstTipIndex).toBeGreaterThan(-1)
      expect(lastSettingsIndex).toBeLessThan(firstDocsIndex)
      expect(lastDocsIndex).toBeLessThan(firstTipIndex)
    })

    it('surfaces a docs entry on a title-only match', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      await user.keyboard('chrome extension')
      const labels = commandLabels()
      expect(labels).toContain('Docs: Chrome Extension')
    })

    it('surfaces a docs entry on a body-keyword match', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      // "swagger" appears only in the API page's searchText keyword soup,
      // not in the label "Docs: API". A hit here proves keyword matching
      // works end-to-end.
      await user.keyboard('swagger')
      const labels = commandLabels()
      expect(labels).toContain('Docs: API')
    })

    it('selecting a docs entry navigates to its path and closes the palette', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<CommandPalette isOpen onClose={onClose} />, { wrapper: Wrapper })
      await user.click(screen.getByPlaceholderText('Type a command...'))
      await user.keyboard('chrome extension')
      await user.click(screen.getByText('Docs: Chrome Extension'))
      expect(mockNavigate).toHaveBeenCalledWith('/docs/extensions/chrome')
      expect(onClose).toHaveBeenCalled()
    })

    it('cycling respects the user\'s query — Next walks tips that match the filter only', async () => {
      const user = userEvent.setup()
      render(<CommandPalette isOpen onClose={vi.fn()} />, { wrapper: Wrapper })
      // Narrow to a single matching tip and confirm the cycle hides the controls.
      await user.click(screen.getByPlaceholderText('Type a command...'))
      // A query specific enough to match exactly one tip's title.
      await user.keyboard('Save and close the editor')
      await user.click(screen.getByText('Tip: Save and close the editor in one keystroke'))
      // Only one tip matches → prev/next are hidden (no cycle to walk).
      expect(screen.queryByRole('button', { name: 'Previous tip' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Next tip' })).toBeNull()
    })
  })
})
