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

    it('Tab moves focus into the selected command item', async () => {
      const user = userEvent.setup()
      render(
        <CommandPalette isOpen onClose={vi.fn()} />,
        { wrapper: Wrapper },
      )

      const input = screen.getByPlaceholderText('Type a command...')
      await user.click(input)
      // Move to second command, then Tab to focus it
      await user.keyboard('{ArrowDown}')
      await user.tab()

      const options = screen.getAllByRole('option')
      expect(document.activeElement).toBe(options[1])
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

    it('Enter on selected bookmark navigates and closes', async () => {
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

      expect(mockNavigate).toHaveBeenCalledWith('/app/bookmarks/1')
      expect(onClose).toHaveBeenCalled()
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
})
