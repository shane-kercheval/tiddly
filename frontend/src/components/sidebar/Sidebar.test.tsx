/**
 * Tests for Sidebar behavior including optimistic updates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useRef, useEffect } from 'react'

// Mock the stores before importing Sidebar
const mockDeleteList = vi.fn()
const mockFetchSidebar = vi.fn()
const mockUpdateSidebar = vi.fn()
const mockSetSidebarOptimistic = vi.fn()
const mockRollbackSidebar = vi.fn()

vi.mock('../../stores/filtersStore', () => ({
  useFiltersStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      filters: [{
        id: '5',
        name: 'Test Filter',
        content_types: ['bookmark'],
        filter_expression: { groups: [{ tags: ['work', 'urgent'], operator: 'AND' }], group_operator: 'OR' },
        default_sort_by: null,
        default_sort_ascending: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }],
      deleteFilter: mockDeleteList,
      createFilter: vi.fn(),
      updateFilter: vi.fn(),
      fetchFilters: vi.fn(),
    }
    return selector(state)
  },
}))

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        sidebar: {
          version: 1,
          items: [
            { type: 'builtin', key: 'all', name: 'All Content' },
            { type: 'filter', id: '5', name: 'Test Filter', content_types: ['bookmark'] },
          ],
        },
        fetchSidebar: mockFetchSidebar,
        updateSidebar: mockUpdateSidebar,
        setSidebarOptimistic: mockSetSidebarOptimistic,
        rollbackSidebar: mockRollbackSidebar,
      }
      return selector(state)
    },
    // Add getState for direct store access in handleCreateList
    {
      getState: () => ({
        sidebar: {
          version: 1,
          items: [
            { type: 'builtin', key: 'all', name: 'All Content' },
            { type: 'filter', id: '5', name: 'Test Filter', content_types: ['bookmark'] },
          ],
        },
      }),
    }
  ),
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
function PathObserver({
  onPathChange,
  onLocationChange,
}: {
  onPathChange?: (path: string) => void
  onLocationChange?: (location: ReturnType<typeof useLocation>) => void
}): null {
  const location = useLocation()
  const prevPathRef = useRef(location.pathname)
  const prevSearchRef = useRef(location.search)

  useEffect(() => {
    const pathChanged = location.pathname !== prevPathRef.current
    const searchChanged = location.search !== prevSearchRef.current

    if (pathChanged) {
      prevPathRef.current = location.pathname
      onPathChange?.(location.pathname)
    }

    if (pathChanged || searchChanged) {
      prevSearchRef.current = location.search
      onLocationChange?.(location)
    }
  }, [location, location.pathname, location.search, location.state, onPathChange, onLocationChange])

  return null
}

function createWrapper(
  initialEntries: string[],
  onPathChange?: (path: string) => void,
  onLocationChange?: (location: ReturnType<typeof useLocation>) => void
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        {(onPathChange || onLocationChange) && (
          <PathObserver onPathChange={onPathChange} onLocationChange={onLocationChange} />
        )}
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
    mockUpdateSidebar.mockResolvedValue(undefined)
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
        expect(mockDeleteList).toHaveBeenCalledWith('5')
      })

      // Verify navigated to /app/content (the "All" route)
      // Navigation happens after successful deletion (sidebar update is optimistic, navigation is not)
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
        expect(mockDeleteList).toHaveBeenCalledWith('5')
      })

      // Path should NOT have changed since we weren't viewing list:5
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(pathChanges.length).toBe(0)
    })

    it('should NOT navigate away when delete fails while viewing the list', async () => {
      const user = userEvent.setup()
      const pathChanges: string[] = []

      // Make delete fail
      mockDeleteList.mockRejectedValue(new Error('API error'))

      // Start viewing list:5
      render(<Sidebar />, {
        wrapper: createWrapper(['/app/bookmarks/lists/5'], (path) => {
          pathChanges.push(path)
        }),
      })

      // Find the delete buttons
      const deleteButtons = screen.getAllByTitle('Delete list')
      await user.click(deleteButtons[0])

      // Second click - confirms delete
      const confirmButtons = screen.getAllByTitle('Click again to confirm')
      await user.click(confirmButtons[0])

      // Wait for delete attempt and rollback
      await waitFor(() => {
        expect(mockDeleteList).toHaveBeenCalledWith('5')
      })

      await waitFor(() => {
        expect(mockRollbackSidebar).toHaveBeenCalled()
      })

      // User should NOT have been navigated away - they stay on the list page
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(pathChanges.length).toBe(0)
    })
  })

  describe('quick add navigation', () => {
    it('uses the current list route when adding a bookmark from a list view', async () => {
      const user = userEvent.setup()
      const locations: ReturnType<typeof useLocation>[] = []

      render(<Sidebar />, {
        wrapper: createWrapper(['/app/content/lists/5?foo=bar'], undefined, (location) => {
          locations.push(location)
        }),
      })

      const bookmarkButtons = screen.getAllByTitle('New Bookmark')
      await user.click(bookmarkButtons[0])

      await waitFor(() => {
        const lastLocation = locations[locations.length - 1]
        expect(lastLocation?.pathname).toBe('/app/bookmarks/new')
        expect(lastLocation?.state).toMatchObject({
          returnTo: '/app/content/lists/5?foo=bar',
          initialTags: ['work', 'urgent'],
        })
      })
    })

    it('passes list tags when creating a note from a list view', async () => {
      const user = userEvent.setup()
      const locations: ReturnType<typeof useLocation>[] = []

      render(<Sidebar />, {
        wrapper: createWrapper(['/app/content/lists/5'], undefined, (location) => {
          locations.push(location)
        }),
      })

      const noteButtons = screen.getAllByTitle('New Note')
      await user.click(noteButtons[0])

      await waitFor(() => {
        const lastLocation = locations[locations.length - 1]
        expect(lastLocation?.pathname).toBe('/app/notes/new')
        expect(lastLocation?.state).toMatchObject({
          returnTo: '/app/content/lists/5',
          initialTags: ['work', 'urgent'],
        })
      })
    })
  })

  describe('optimistic updates', () => {
    describe('create group', () => {
      it('calls setSidebarOptimistic before updateSidebar', async () => {
        const user = userEvent.setup()
        const callOrder: string[] = []

        mockSetSidebarOptimistic.mockImplementation(() => {
          callOrder.push('setSidebarOptimistic')
        })
        mockUpdateSidebar.mockImplementation(() => {
          callOrder.push('updateSidebar')
          return Promise.resolve(undefined)
        })

        render(<Sidebar />, {
          wrapper: createWrapper(['/app/content']),
        })

        // Click the "Group" button to create a new group
        const groupButtons = screen.getAllByTitle('New Group')
        await user.click(groupButtons[0])

        await waitFor(() => {
          expect(mockSetSidebarOptimistic).toHaveBeenCalled()
        })

        await waitFor(() => {
          expect(mockUpdateSidebar).toHaveBeenCalled()
        })

        // Verify optimistic update happens before API call
        expect(callOrder).toEqual(['setSidebarOptimistic', 'updateSidebar'])
      })

      it('calls setSidebarOptimistic with new group at the beginning', async () => {
        const user = userEvent.setup()

        render(<Sidebar />, {
          wrapper: createWrapper(['/app/content']),
        })

        const groupButtons = screen.getAllByTitle('New Group')
        await user.click(groupButtons[0])

        await waitFor(() => {
          expect(mockSetSidebarOptimistic).toHaveBeenCalled()
        })

        // Verify the new group is added to the front
        const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
        expect(optimisticItems[0].type).toBe('group')
        expect(optimisticItems[0].name).toBe('New Group')
        expect(optimisticItems[0].items).toEqual([])
      })

      it('calls rollbackSidebar when updateSidebar fails', async () => {
        const user = userEvent.setup()

        mockUpdateSidebar.mockRejectedValue(new Error('API error'))

        render(<Sidebar />, {
          wrapper: createWrapper(['/app/content']),
        })

        const groupButtons = screen.getAllByTitle('New Group')
        await user.click(groupButtons[0])

        await waitFor(() => {
          expect(mockRollbackSidebar).toHaveBeenCalled()
        })
      })
    })

    describe('delete list', () => {
      it('calls setSidebarOptimistic before deleteList API call', async () => {
        const user = userEvent.setup()
        const callOrder: string[] = []

        mockSetSidebarOptimistic.mockImplementation(() => {
          callOrder.push('setSidebarOptimistic')
        })
        mockDeleteList.mockImplementation(() => {
          callOrder.push('deleteList')
          return Promise.resolve(undefined)
        })

        render(<Sidebar />, {
          wrapper: createWrapper(['/app/content']),
        })

        // Find the delete buttons
        const deleteButtons = screen.getAllByTitle('Delete list')
        await user.click(deleteButtons[0])

        // Second click - confirms delete
        const confirmButtons = screen.getAllByTitle('Click again to confirm')
        await user.click(confirmButtons[0])

        await waitFor(() => {
          expect(mockSetSidebarOptimistic).toHaveBeenCalled()
        })

        await waitFor(() => {
          expect(mockDeleteList).toHaveBeenCalled()
        })

        // Verify optimistic update happens before API call
        expect(callOrder).toEqual(['setSidebarOptimistic', 'deleteList'])
      })

      it('calls setSidebarOptimistic with list removed', async () => {
        const user = userEvent.setup()

        render(<Sidebar />, {
          wrapper: createWrapper(['/app/content']),
        })

        const deleteButtons = screen.getAllByTitle('Delete list')
        await user.click(deleteButtons[0])

        const confirmButtons = screen.getAllByTitle('Click again to confirm')
        await user.click(confirmButtons[0])

        await waitFor(() => {
          expect(mockSetSidebarOptimistic).toHaveBeenCalled()
        })

        // Verify the list is removed from sidebar
        const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
        const listItem = optimisticItems.find(
          (item: { type: string; id?: number }) => item.type === 'list' && item.id === 5
        )
        expect(listItem).toBeUndefined()
      })

      it('calls rollbackSidebar when deleteList fails', async () => {
        const user = userEvent.setup()

        mockDeleteList.mockRejectedValue(new Error('API error'))

        render(<Sidebar />, {
          wrapper: createWrapper(['/app/content']),
        })

        const deleteButtons = screen.getAllByTitle('Delete list')
        await user.click(deleteButtons[0])

        const confirmButtons = screen.getAllByTitle('Click again to confirm')
        await user.click(confirmButtons[0])

        await waitFor(() => {
          expect(mockRollbackSidebar).toHaveBeenCalled()
        })
      })
    })
  })
})
