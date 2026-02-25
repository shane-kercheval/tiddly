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
import * as config from '../config'

// Mock the config module
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>()
  return {
    ...actual,
    isDevMode: true,
  }
})

// Mock the consent store
let mockNeedsConsent: boolean | null = false
vi.mock('../stores/consentStore', () => ({
  useConsentStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      needsConsent: mockNeedsConsent,
    }
    return selector ? selector(state) : state
  },
}))

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

// Track right sidebar state for tests
let mockActivePanel: string | null = null
const mockRightSidebarWidth = 384
vi.mock('../stores/rightSidebarStore', () => ({
  useRightSidebarStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      activePanel: mockActivePanel,
      width: mockRightSidebarWidth,
      setActivePanel: vi.fn(),
      togglePanel: vi.fn(),
      setWidth: vi.fn(),
    }
    return selector ? selector(state) : state
  },
  MIN_SIDEBAR_WIDTH: 280,
  MIN_CONTENT_WIDTH: 600,
}))

function TestPage(): ReactNode {
  return <div data-testid="test-page">Test Page Content</div>
}

function renderLayout(route = '/app/bookmarks'): void {
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/app/bookmarks" element={<TestPage />} />
          <Route path="/app/notes/:id" element={<TestPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActivePanel = null
    mockNeedsConsent = false
    vi.mocked(config).isDevMode = true
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

  describe('consent-gated fetching', () => {
    it('should not fetch data when consent is not ready', () => {
      vi.mocked(config).isDevMode = false
      mockNeedsConsent = null // consent not yet checked

      renderLayout()

      expect(mockFetchSidebar).not.toHaveBeenCalled()
      expect(mockFetchFilters).not.toHaveBeenCalled()
      expect(mockFetchTags).not.toHaveBeenCalled()
    })

    it('should show ContentAreaSpinner when consent is not ready', () => {
      vi.mocked(config).isDevMode = false
      mockNeedsConsent = null

      renderLayout()

      // Sidebar shell renders but content area shows spinner
      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(screen.queryByTestId('test-page')).not.toBeInTheDocument()
    })

    it('should fetch data once consent resolves', () => {
      vi.mocked(config).isDevMode = false
      mockNeedsConsent = false // consent confirmed

      renderLayout()

      expect(mockFetchSidebar).toHaveBeenCalledTimes(1)
      expect(mockFetchFilters).toHaveBeenCalledTimes(1)
      expect(mockFetchTags).toHaveBeenCalledTimes(1)
    })
  })

  describe('right sidebar margin', () => {
    it('should not apply margin when sidebar is closed', () => {
      mockActivePanel = null
      renderLayout('/app/notes/abc-123')

      const main = screen.getByRole('main')
      expect(main.style.marginRight).toBe('0px')
    })

    it('should apply margin when sidebar is open on detail page', () => {
      mockActivePanel = 'history'
      renderLayout('/app/notes/abc-123')

      const main = screen.getByRole('main')
      expect(main.style.marginRight).toBe(`${mockRightSidebarWidth}px`)
    })

    it('should not apply margin on non-detail pages even when sidebar is open', () => {
      mockActivePanel = 'history'
      renderLayout('/app/bookmarks')

      const main = screen.getByRole('main')
      expect(main.style.marginRight).toBe('0px')
    })
  })
})
