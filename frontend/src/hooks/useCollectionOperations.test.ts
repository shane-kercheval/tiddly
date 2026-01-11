/**
 * Tests for useCollectionOperations hook.
 *
 * Tests all collection CRUD operations with optimistic updates and rollback.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCollectionOperations } from './useCollectionOperations'
import { useSettingsStore } from '../stores/settingsStore'
import { useFiltersStore } from '../stores/filtersStore'
import type { SidebarOrderComputed, ContentFilter } from '../types'

// Mock the stores
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('../stores/filtersStore', () => ({
  useFiltersStore: vi.fn(),
}))

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}))

const mockUseSettingsStore = useSettingsStore as unknown as Mock
const mockUseFiltersStore = useFiltersStore as unknown as Mock

// Sample data
const mockFilters: ContentFilter[] = [
  {
    id: 'filter-1',
    name: 'Work Filter',
    content_types: ['bookmark', 'note'],
    filter_expression: { groups: [{ tags: ['work'], operator: 'AND' }], group_operator: 'OR' },
    default_sort_by: null,
    default_sort_ascending: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'filter-2',
    name: 'Personal Filter',
    content_types: ['bookmark'],
    filter_expression: { groups: [{ tags: ['personal'], operator: 'AND' }], group_operator: 'OR' },
    default_sort_by: null,
    default_sort_ascending: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
]

const createMockSidebar = (): SidebarOrderComputed => ({
  version: 1,
  items: [
    { type: 'builtin', key: 'all', name: 'All Content' },
    { type: 'filter', id: 'filter-1', name: 'Work Filter', content_types: ['bookmark', 'note'] },
    { type: 'filter', id: 'filter-2', name: 'Personal Filter', content_types: ['bookmark'] },
  ],
})

describe('useCollectionOperations', () => {
  let mockSetSidebarOptimistic: Mock
  let mockRollbackSidebar: Mock
  let mockUpdateSidebar: Mock

  beforeEach(() => {
    vi.clearAllMocks()

    mockSetSidebarOptimistic = vi.fn()
    mockRollbackSidebar = vi.fn()
    mockUpdateSidebar = vi.fn().mockResolvedValue(undefined)

    // Setup settings store mock with selector support
    mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
      const state = {
        sidebar: createMockSidebar(),
        setSidebarOptimistic: mockSetSidebarOptimistic,
        rollbackSidebar: mockRollbackSidebar,
        updateSidebar: mockUpdateSidebar,
      }
      return selector ? selector(state) : state
    })

    // Setup filters store mock
    mockUseFiltersStore.mockImplementation((selector: (state: unknown) => unknown) => {
      const state = {
        filters: mockFilters,
      }
      return selector ? selector(state) : state
    })
  })

  describe('createCollection', () => {
    it('creates a collection with optimistic update', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.createCollection('New Collection', ['filter-1'])
      })

      // Verify optimistic update was called
      expect(mockSetSidebarOptimistic).toHaveBeenCalledTimes(1)
      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]

      // New collection should be first
      expect(optimisticItems[0].type).toBe('collection')
      expect(optimisticItems[0].name).toBe('New Collection')
      expect(optimisticItems[0].items).toHaveLength(1)
      expect(optimisticItems[0].items[0].id).toBe('filter-1')

      // filter-1 should be removed from root level
      const rootFilterIds = optimisticItems
        .filter((item: { type: string }) => item.type === 'filter')
        .map((item: { id: string }) => item.id)
      expect(rootFilterIds).not.toContain('filter-1')
      expect(rootFilterIds).toContain('filter-2')

      // Verify API call
      expect(mockUpdateSidebar).toHaveBeenCalledTimes(1)
    })

    it('creates an empty collection', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.createCollection('Empty Collection', [])
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      expect(optimisticItems[0].type).toBe('collection')
      expect(optimisticItems[0].name).toBe('Empty Collection')
      expect(optimisticItems[0].items).toHaveLength(0)
    })

    it('rolls back on API failure', async () => {
      mockUpdateSidebar.mockRejectedValueOnce(new Error('API error'))

      const { result } = renderHook(() => useCollectionOperations())

      await expect(
        act(async () => {
          await result.current.createCollection('New Collection', ['filter-1'])
        })
      ).rejects.toThrow('Failed to create collection')

      expect(mockRollbackSidebar).toHaveBeenCalledTimes(1)
    })

    it('does nothing if sidebar is null', async () => {
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: null,
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
        }
        return selector ? selector(state) : state
      })

      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.createCollection('New Collection', ['filter-1'])
      })

      expect(mockSetSidebarOptimistic).not.toHaveBeenCalled()
      expect(mockUpdateSidebar).not.toHaveBeenCalled()
    })

    it('handles non-existent filter IDs gracefully', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.createCollection('New Collection', ['non-existent-filter'])
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      expect(optimisticItems[0].items).toHaveLength(0) // Non-existent filter is skipped
    })
  })

  describe('updateCollection', () => {
    beforeEach(() => {
      // Setup sidebar with a collection
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: {
            version: 1,
            items: [
              { type: 'builtin', key: 'all', name: 'All Content' },
              {
                type: 'collection',
                id: 'collection-1',
                name: 'Original Collection',
                items: [
                  { type: 'filter', id: 'filter-1', name: 'Work Filter', content_types: ['bookmark', 'note'] },
                ],
              },
              { type: 'filter', id: 'filter-2', name: 'Personal Filter', content_types: ['bookmark'] },
            ],
          },
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
        }
        return selector ? selector(state) : state
      })
    })

    it('updates collection name', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.updateCollection('collection-1', 'Renamed Collection', ['filter-1'])
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      const collection = optimisticItems.find(
        (item: { type: string; id: string }) => item.type === 'collection' && item.id === 'collection-1'
      )
      expect(collection.name).toBe('Renamed Collection')
    })

    it('adds new filters to collection', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.updateCollection('collection-1', 'Original Collection', ['filter-1', 'filter-2'])
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      const collection = optimisticItems.find(
        (item: { type: string; id: string }) => item.type === 'collection' && item.id === 'collection-1'
      )
      expect(collection.items).toHaveLength(2)

      // filter-2 should be removed from root
      const rootFilters = optimisticItems.filter((item: { type: string }) => item.type === 'filter')
      expect(rootFilters).toHaveLength(0)
    })

    it('removes filters from collection back to root', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.updateCollection('collection-1', 'Original Collection', [])
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      const collection = optimisticItems.find(
        (item: { type: string; id: string }) => item.type === 'collection' && item.id === 'collection-1'
      )
      expect(collection.items).toHaveLength(0)

      // filter-1 should be at root now
      const rootFilters = optimisticItems.filter((item: { type: string }) => item.type === 'filter')
      expect(rootFilters).toHaveLength(2) // filter-1 moved to root + filter-2 already at root
    })

    it('rolls back on API failure', async () => {
      mockUpdateSidebar.mockRejectedValueOnce(new Error('API error'))

      const { result } = renderHook(() => useCollectionOperations())

      await expect(
        act(async () => {
          await result.current.updateCollection('collection-1', 'New Name', ['filter-1'])
        })
      ).rejects.toThrow('Failed to update collection')

      expect(mockRollbackSidebar).toHaveBeenCalledTimes(1)
    })
  })

  describe('renameCollection', () => {
    beforeEach(() => {
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: {
            version: 1,
            items: [
              {
                type: 'collection',
                id: 'collection-1',
                name: 'Original Name',
                items: [],
              },
            ],
          },
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
        }
        return selector ? selector(state) : state
      })
    })

    it('renames collection with optimistic update', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.renameCollection('collection-1', 'New Name')
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      expect(optimisticItems[0].name).toBe('New Name')
      expect(mockUpdateSidebar).toHaveBeenCalledTimes(1)
    })

    it('rolls back and shows toast on API failure', async () => {
      const toast = await import('react-hot-toast')
      mockUpdateSidebar.mockRejectedValueOnce(new Error('API error'))

      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.renameCollection('collection-1', 'New Name')
      })

      expect(mockRollbackSidebar).toHaveBeenCalledTimes(1)
      expect(toast.default.error).toHaveBeenCalledWith('Failed to rename collection')
    })

    it('does nothing if sidebar is null', async () => {
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: null,
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
        }
        return selector ? selector(state) : state
      })

      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.renameCollection('collection-1', 'New Name')
      })

      expect(mockSetSidebarOptimistic).not.toHaveBeenCalled()
    })
  })

  describe('deleteCollection', () => {
    beforeEach(() => {
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: {
            version: 1,
            items: [
              { type: 'builtin', key: 'all', name: 'All Content' },
              {
                type: 'collection',
                id: 'collection-1',
                name: 'Collection to Delete',
                items: [
                  { type: 'filter', id: 'filter-1', name: 'Work Filter', content_types: ['bookmark', 'note'] },
                ],
              },
            ],
          },
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
        }
        return selector ? selector(state) : state
      })
    })

    it('deletes collection and moves contents to root', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.deleteCollection('collection-1')
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]

      // Collection should be gone
      const collections = optimisticItems.filter((item: { type: string }) => item.type === 'collection')
      expect(collections).toHaveLength(0)

      // Filter should be at root
      const filters = optimisticItems.filter((item: { type: string }) => item.type === 'filter')
      expect(filters).toHaveLength(1)
      expect(filters[0].id).toBe('filter-1')

      expect(mockUpdateSidebar).toHaveBeenCalledTimes(1)
    })

    it('rolls back and shows toast on API failure', async () => {
      const toast = await import('react-hot-toast')
      mockUpdateSidebar.mockRejectedValueOnce(new Error('API error'))

      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.deleteCollection('collection-1')
      })

      expect(mockRollbackSidebar).toHaveBeenCalledTimes(1)
      expect(toast.default.error).toHaveBeenCalledWith('Failed to delete collection')
    })

    it('does nothing if collection not found', async () => {
      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.deleteCollection('non-existent-collection')
      })

      // setSidebarOptimistic should still be called, but the items won't change
      // Actually, let me check the implementation - if collection is not found, it returns early
      expect(mockSetSidebarOptimistic).not.toHaveBeenCalled()
    })

    it('does nothing if sidebar is null', async () => {
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: null,
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
        }
        return selector ? selector(state) : state
      })

      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.deleteCollection('collection-1')
      })

      expect(mockSetSidebarOptimistic).not.toHaveBeenCalled()
    })
  })

  describe('optimistic update ordering', () => {
    it('applies optimistic update before API call', async () => {
      const callOrder: string[] = []

      mockSetSidebarOptimistic.mockImplementation(() => {
        callOrder.push('optimistic')
      })

      mockUpdateSidebar.mockImplementation(() => {
        callOrder.push('api')
        return Promise.resolve()
      })

      const { result } = renderHook(() => useCollectionOperations())

      await act(async () => {
        await result.current.createCollection('New Collection', [])
      })

      expect(callOrder).toEqual(['optimistic', 'api'])
    })
  })
})
