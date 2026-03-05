/**
 * Tests for CommandPalette command list composition.
 *
 * Verifies that non-navigable builtins (e.g. command-palette) are excluded
 * from the command list while navigable builtins and filters appear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// Mock stores before importing CommandPalette

vi.mock('../hooks/useContentQuery', () => ({
  useContentQuery: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
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
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
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
      const allButtons = screen.getAllByRole('button')
      const commandLabels = allButtons.map((btn) => btn.textContent)
      expect(commandLabels).not.toContain('Command Palette')
    })
  })
})
