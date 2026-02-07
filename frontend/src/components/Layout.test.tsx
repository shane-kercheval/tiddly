/**
 * Tests for the Layout component.
 *
 * Key behavior: Layout fetches shared data (sidebar, filters, tags) exactly once on mount.
 * This centralized fetching prevents duplicate API calls from child components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './Layout'

// Create mock functions that we can spy on
const mockFetchSidebar = vi.fn()
const mockFetchFilters = vi.fn()
const mockFetchTags = vi.fn()

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      sidebar: {
        version: 1,
        items: [
          { type: 'builtin', key: 'all', name: 'All Content' },
          { type: 'builtin', key: 'archived', name: 'Archived' },
          { type: 'builtin', key: 'trash', name: 'Trash' },
          { type: 'filter', id: 1, name: 'My Filter', content_types: ['bookmark', 'note'] },
        ],
      },
      fetchSidebar: mockFetchSidebar,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../stores/filtersStore', () => ({
  useFiltersStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      filters: [],
      fetchFilters: mockFetchFilters,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      tags: [],
      fetchTags: mockFetchTags,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../stores/uiPreferencesStore', () => ({
  useUIPreferencesStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      fullWidthLayout: false,
      toggleFullWidthLayout: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../stores/sidebarStore', () => ({
  useSidebarStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      isCollapsed: false,
      isMobileOpen: false,
      expandedSections: ['settings'],
      collapsedGroupIds: [],
      toggleCollapse: vi.fn(),
      toggleMobile: vi.fn(),
      closeMobile: vi.fn(),
      toggleSection: vi.fn(),
      toggleGroup: vi.fn(),
      isGroupCollapsed: () => false,
    }
    return selector ? selector(state) : state
  },
}))

// Track history sidebar state for tests
let mockHistorySidebarOpen = false
vi.mock('../stores/historySidebarStore', () => ({
  useHistorySidebarStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      isOpen: mockHistorySidebarOpen,
      setOpen: vi.fn(),
    }
    return selector ? selector(state) : state
  },
  HISTORY_SIDEBAR_MARGIN_CLASS: 'md:mr-96',
}))

function TestPage(): ReactNode {
  return <div data-testid="test-page">Test Page Content</div>
}

function renderLayout(): void {
  render(
    <MemoryRouter initialEntries={['/app/bookmarks']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/app/bookmarks" element={<TestPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHistorySidebarOpen = false
  })

  describe('centralized data fetching', () => {
    it('should fetch sidebar exactly once on mount', () => {
      renderLayout()

      expect(mockFetchSidebar).toHaveBeenCalledTimes(1)
    })

    it('should fetch filters exactly once on mount', () => {
      renderLayout()

      expect(mockFetchFilters).toHaveBeenCalledTimes(1)
    })

    it('should fetch tags exactly once on mount', () => {
      renderLayout()

      expect(mockFetchTags).toHaveBeenCalledTimes(1)
    })

    it('should fetch all shared data in a single mount cycle', () => {
      renderLayout()

      // All three should be called exactly once
      expect(mockFetchSidebar).toHaveBeenCalledTimes(1)
      expect(mockFetchFilters).toHaveBeenCalledTimes(1)
      expect(mockFetchTags).toHaveBeenCalledTimes(1)
    })
  })

  describe('rendering', () => {
    it('should render child routes via Outlet', () => {
      renderLayout()

      expect(screen.getByTestId('test-page')).toBeInTheDocument()
    })

    it('should render the sidebar with navigation items', () => {
      renderLayout()

      // Sidebar contains the builtin "All Content" item (appears in both mobile and desktop sidebars)
      expect(screen.getAllByText('All Content').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('history sidebar margin', () => {
    it('should not apply margin when history sidebar is closed', () => {
      mockHistorySidebarOpen = false
      renderLayout()

      const main = screen.getByRole('main')
      expect(main.className).not.toContain('md:mr-96')
    })

    it('should apply margin when history sidebar is open', () => {
      mockHistorySidebarOpen = true
      renderLayout()

      const main = screen.getByRole('main')
      expect(main.className).toContain('md:mr-96')
    })
  })
})
