/**
 * Tests for Sidebar delete navigation behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'

// Mock the stores before importing Sidebar
const mockDeleteList = vi.fn()
const mockFetchSidebar = vi.fn()

vi.mock('../../stores/listsStore', () => ({
  useListsStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      lists: [{ id: 5, name: 'Test List' }],
      deleteList: mockDeleteList,
      createList: vi.fn(),
      updateList: vi.fn(),
      fetchLists: vi.fn(),
    }
    return selector(state)
  },
}))

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      sidebar: {
        version: 1,
        items: [
          { type: 'builtin', key: 'all', name: 'All' },
          { type: 'list', id: 5, name: 'Test List', content_types: ['bookmark'] },
        ],
      },
      fetchSidebar: mockFetchSidebar,
      updateSidebar: vi.fn().mockResolvedValue(undefined),
      setSidebarOptimistic: vi.fn(),
      rollbackSidebar: vi.fn(),
    }
    return selector(state)
  },
}))

vi.mock('../../stores/tagsStore', () => ({
  useTagsStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      tags: [],
    }
    return selector(state)
  },
}))

vi.mock('../../stores/sidebarStore', () => ({
  useSidebarStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      isCollapsed: false,
      isMobileOpen: false,
      expandedSections: [],
      toggleSection: vi.fn(),
      toggleCollapse: vi.fn(),
      toggleMobile: vi.fn(),
      closeMobile: vi.fn(),
      isGroupCollapsed: () => false,
      toggleGroup: vi.fn(),
    }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

vi.mock('../../queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../utils/invalidateListQueries', () => ({
  invalidateListQueries: vi.fn().mockResolvedValue(undefined),
}))

// Import after mocks are set up
import { Sidebar } from './Sidebar'

// Helper component to observe path changes
function PathObserver({ onPathChange }: { onPathChange: (path: string) => void }): null {
  const location = useLocation()
  const [prevPath, setPrevPath] = useState(location.pathname)

  useEffect(() => {
    if (location.pathname !== prevPath) {
      setPrevPath(location.pathname)
      onPathChange(location.pathname)
    }
  }, [location.pathname, prevPath, onPathChange])

  return null
}

function createWrapper(initialEntries: string[], onPathChange?: (path: string) => void) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        {onPathChange && <PathObserver onPathChange={onPathChange} />}
        {children}
      </MemoryRouter>
    )
  }
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteList.mockResolvedValue(undefined)
    mockFetchSidebar.mockResolvedValue(undefined)
  })

  describe('delete list navigation', () => {
    it('should navigate to /app/content when deleting the currently viewed list', async () => {
      const user = userEvent.setup()
      const pathChanges: string[] = []

      // Start with path-based route /app/bookmarks/lists/5 (viewing the list we're about to delete)
      render(<Sidebar />, {
        wrapper: createWrapper(['/app/bookmarks/lists/5'], (path) => {
          pathChanges.push(path)
        }),
      })

      // Find the delete buttons (there are 2: mobile and desktop sidebars)
      const deleteButtons = screen.getAllByTitle('Delete list')
      expect(deleteButtons.length).toBeGreaterThan(0)

      // Use the first one (desktop sidebar)
      await user.click(deleteButtons[0])

      // Second click - confirms delete
      const confirmButtons = screen.getAllByTitle('Click again to confirm')
      await user.click(confirmButtons[0])

      // Wait for delete to complete
      await waitFor(() => {
        expect(mockDeleteList).toHaveBeenCalledWith(5)
      })

      await waitFor(() => {
        expect(mockFetchSidebar).toHaveBeenCalled()
      })

      // Verify navigated to /app/content (the "All" route)
      await waitFor(() => {
        expect(pathChanges).toContain('/app/content')
      })
    })

    it('should NOT navigate when deleting a list that is not currently viewed', async () => {
      const user = userEvent.setup()
      const pathChanges: string[] = []

      // Start at /app/content (All view, NOT viewing list:5)
      render(<Sidebar />, {
        wrapper: createWrapper(['/app/content'], (path) => {
          pathChanges.push(path)
        }),
      })

      // Find the delete buttons
      const deleteButtons = screen.getAllByTitle('Delete list')

      // First click - shows confirmation
      await user.click(deleteButtons[0])

      // Second click - confirms delete
      const confirmButtons = screen.getAllByTitle('Click again to confirm')
      await user.click(confirmButtons[0])

      // Wait for delete to complete
      await waitFor(() => {
        expect(mockDeleteList).toHaveBeenCalledWith(5)
      })

      // Path should NOT have changed since we weren't viewing list:5
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(pathChanges.length).toBe(0)
    })
  })
})
