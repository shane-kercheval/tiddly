/**
 * Tests for useFilterOperations hook.
 *
 * Tests all filter CRUD operations with optimistic updates and rollback.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilterOperations } from './useFilterOperations'
import { useSettingsStore } from '../stores/settingsStore'
import { useFiltersStore } from '../stores/filtersStore'
import { useTagsStore } from '../stores/tagsStore'
import * as invalidateModule from '../utils/invalidateFilterQueries'
import type { SidebarOrderComputed, ContentFilter } from '../types'

// Mock the stores
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('../stores/filtersStore', () => ({
  useFiltersStore: vi.fn(),
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: vi.fn(),
}))

// Mock queryClient
vi.mock('../queryClient', () => ({
  queryClient: {},
}))

// Mock invalidateFilterQueries
vi.mock('../utils/invalidateFilterQueries', () => ({
  invalidateFilterQueries: vi.fn().mockResolvedValue(undefined),
}))

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}))

const mockUseSettingsStore = useSettingsStore as unknown as Mock
const mockUseFiltersStore = useFiltersStore as unknown as Mock
const mockUseTagsStore = useTagsStore as unknown as Mock

// Sample data
const mockFilter: ContentFilter = {
  id: 'filter-1',
  name: 'Work Filter',
  content_types: ['bookmark', 'note'],
  filter_expression: { groups: [{ tags: ['work'], operator: 'AND' }], group_operator: 'OR' },
  default_sort_by: null,
  default_sort_ascending: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const createMockSidebar = (): SidebarOrderComputed => ({
  version: 1,
  items: [
    { type: 'builtin', key: 'all', name: 'All Content' },
    { type: 'filter', id: 'filter-1', name: 'Work Filter', content_types: ['bookmark', 'note'] },
    {
      type: 'collection',
      id: 'collection-1',
      name: 'My Collection',
      items: [
        { type: 'filter', id: 'filter-2', name: 'Nested Filter', content_types: ['note'] },
      ],
    },
  ],
})

describe('useFilterOperations', () => {
  let mockSetSidebarOptimistic: Mock
  let mockRollbackSidebar: Mock
  let mockUpdateSidebar: Mock
  let mockFetchSidebar: Mock
  let mockStoreCreateFilter: Mock
  let mockStoreUpdateFilter: Mock
  let mockStoreDeleteFilter: Mock
  let mockFetchTags: Mock

  beforeEach(() => {
    vi.clearAllMocks()

    mockSetSidebarOptimistic = vi.fn()
    mockRollbackSidebar = vi.fn()
    mockUpdateSidebar = vi.fn().mockResolvedValue(undefined)
    mockFetchSidebar = vi.fn().mockResolvedValue(undefined)
    mockStoreCreateFilter = vi.fn().mockResolvedValue(mockFilter)
    mockStoreUpdateFilter = vi.fn().mockResolvedValue(mockFilter)
    mockStoreDeleteFilter = vi.fn().mockResolvedValue(undefined)
    mockFetchTags = vi.fn().mockResolvedValue(undefined)

    // Setup settings store mock with selector support
    const settingsState = {
      sidebar: createMockSidebar(),
      setSidebarOptimistic: mockSetSidebarOptimistic,
      rollbackSidebar: mockRollbackSidebar,
      updateSidebar: mockUpdateSidebar,
      fetchSidebar: mockFetchSidebar,
    }

    mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
      return selector ? selector(settingsState) : settingsState
    })

    // Also mock getState for the hook's direct access
    ;(useSettingsStore as unknown as { getState: () => unknown }).getState = () => settingsState

    // Setup filters store mock
    mockUseFiltersStore.mockImplementation((selector: (state: unknown) => unknown) => {
      const state = {
        createFilter: mockStoreCreateFilter,
        updateFilter: mockStoreUpdateFilter,
        deleteFilter: mockStoreDeleteFilter,
      }
      return selector ? selector(state) : state
    })

    // Setup tags store mock
    mockUseTagsStore.mockImplementation((selector: (state: unknown) => unknown) => {
      const state = {
        fetchTags: mockFetchTags,
      }
      return selector ? selector(state) : state
    })
  })

  describe('createFilter', () => {
    it('creates a filter and moves it to top of sidebar', async () => {
      const { result } = renderHook(() => useFilterOperations())

      const createData = {
        name: 'New Filter',
        content_types: ['bookmark'] as ('bookmark' | 'note' | 'prompt')[],
        filter_expression: { groups: [{ tags: ['test'], operator: 'AND' as const }], group_operator: 'OR' as const },
      }

      let createdFilter: ContentFilter | undefined
      await act(async () => {
        createdFilter = await result.current.createFilter(createData)
      })

      expect(mockStoreCreateFilter).toHaveBeenCalledWith(createData)
      expect(mockFetchSidebar).toHaveBeenCalled()
      expect(mockUpdateSidebar).toHaveBeenCalled()
      expect(createdFilter).toEqual(mockFilter)

      // Verify new filter is moved to top
      const updateCall = mockUpdateSidebar.mock.calls[0][0]
      expect(updateCall.items[0].type).toBe('filter')
      expect(updateCall.items[0].id).toBe('filter-1')
    })

    it('returns the created filter', async () => {
      const { result } = renderHook(() => useFilterOperations())

      let createdFilter: ContentFilter | undefined
      await act(async () => {
        createdFilter = await result.current.createFilter({
          name: 'New Filter',
          content_types: ['bookmark'],
          filter_expression: { groups: [], group_operator: 'OR' },
        })
      })

      expect(createdFilter).toEqual(mockFilter)
    })

    it('propagates errors from store', async () => {
      mockStoreCreateFilter.mockRejectedValueOnce(new Error('Creation failed'))

      const { result } = renderHook(() => useFilterOperations())

      await expect(
        act(async () => {
          await result.current.createFilter({
            name: 'New Filter',
            content_types: ['bookmark'],
            filter_expression: { groups: [], group_operator: 'OR' },
          })
        })
      ).rejects.toThrow('Creation failed')
    })

    it('refreshes tags after creating filter (filter may create new tags)', async () => {
      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.createFilter({
          name: 'New Filter',
          content_types: ['bookmark'],
          filter_expression: { groups: [{ tags: ['new-tag'], operator: 'AND' }], group_operator: 'OR' },
        })
      })

      expect(mockFetchTags).toHaveBeenCalled()
    })
  })

  describe('updateFilter', () => {
    it('updates filter with optimistic sidebar update', async () => {
      const { result } = renderHook(() => useFilterOperations())

      const updateData = { name: 'Updated Filter Name', content_types: ['note'] as ('bookmark' | 'note' | 'prompt')[] }

      await act(async () => {
        await result.current.updateFilter('filter-1', updateData)
      })

      // Verify optimistic update
      expect(mockSetSidebarOptimistic).toHaveBeenCalledTimes(1)
      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]

      // Find the updated filter
      const updatedFilter = optimisticItems.find(
        (item: { type: string; id: string }) => item.type === 'filter' && item.id === 'filter-1'
      )
      expect(updatedFilter.name).toBe('Updated Filter Name')
      expect(updatedFilter.content_types).toEqual(['note'])

      // Verify store update was called
      expect(mockStoreUpdateFilter).toHaveBeenCalledWith('filter-1', updateData)
    })

    it('updates filter nested in collection', async () => {
      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.updateFilter('filter-2', { name: 'Updated Nested Filter' })
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      const collection = optimisticItems.find((item: { type: string }) => item.type === 'collection')
      expect(collection.items[0].name).toBe('Updated Nested Filter')
    })

    it('invalidates filter queries after update', async () => {
      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.updateFilter('filter-1', { name: 'Updated' })
      })

      expect(invalidateModule.invalidateFilterQueries).toHaveBeenCalled()
    })

    it('rolls back and re-throws on API failure', async () => {
      mockStoreUpdateFilter.mockRejectedValueOnce(new Error('Update failed'))

      const { result } = renderHook(() => useFilterOperations())

      await expect(
        act(async () => {
          await result.current.updateFilter('filter-1', { name: 'New Name' })
        })
      ).rejects.toThrow('Update failed')

      expect(mockRollbackSidebar).toHaveBeenCalledTimes(1)
    })

    it('skips optimistic update if no name or content_types change', async () => {
      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.updateFilter('filter-1', {
          filter_expression: { groups: [{ tags: ['new-tag'], operator: 'AND' }], group_operator: 'OR' },
        })
      })

      // No optimistic update needed since sidebar doesn't display filter_expression
      expect(mockSetSidebarOptimistic).not.toHaveBeenCalled()
      expect(mockStoreUpdateFilter).toHaveBeenCalled()
    })

    it('returns the updated filter', async () => {
      const updatedFilter = { ...mockFilter, name: 'Updated Name' }
      mockStoreUpdateFilter.mockResolvedValueOnce(updatedFilter)

      const { result } = renderHook(() => useFilterOperations())

      let returnedFilter: ContentFilter | undefined
      await act(async () => {
        returnedFilter = await result.current.updateFilter('filter-1', { name: 'Updated Name' })
      })

      expect(returnedFilter).toEqual(updatedFilter)
    })

    it('refreshes tags after updating filter (filter may create new tags)', async () => {
      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.updateFilter('filter-1', {
          filter_expression: { groups: [{ tags: ['new-tag'], operator: 'AND' }], group_operator: 'OR' },
        })
      })

      expect(mockFetchTags).toHaveBeenCalled()
    })
  })

  describe('deleteFilter', () => {
    it('deletes filter with optimistic update', async () => {
      const { result } = renderHook(() => useFilterOperations())

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.deleteFilter('filter-1')
      })

      expect(success).toBe(true)
      expect(mockSetSidebarOptimistic).toHaveBeenCalledTimes(1)

      // Verify filter is removed
      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      const filter = optimisticItems.find(
        (item: { type: string; id: string }) => item.type === 'filter' && item.id === 'filter-1'
      )
      expect(filter).toBeUndefined()

      expect(mockStoreDeleteFilter).toHaveBeenCalledWith('filter-1')
    })

    it('deletes filter nested in collection', async () => {
      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.deleteFilter('filter-2')
      })

      const optimisticItems = mockSetSidebarOptimistic.mock.calls[0][0]
      const collection = optimisticItems.find((item: { type: string }) => item.type === 'collection')
      expect(collection.items).toHaveLength(0)
    })

    it('returns false and shows toast on API failure', async () => {
      const toast = await import('react-hot-toast')
      mockStoreDeleteFilter.mockRejectedValueOnce(new Error('Delete failed'))

      const { result } = renderHook(() => useFilterOperations())

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.deleteFilter('filter-1')
      })

      expect(success).toBe(false)
      expect(mockRollbackSidebar).toHaveBeenCalledTimes(1)
      expect(toast.default.error).toHaveBeenCalledWith('Failed to delete filter')
    })

    it('still applies optimistic update even if sidebar is null (but skips it)', async () => {
      mockUseSettingsStore.mockImplementation((selector: (state: unknown) => unknown) => {
        const state = {
          sidebar: null,
          setSidebarOptimistic: mockSetSidebarOptimistic,
          rollbackSidebar: mockRollbackSidebar,
          updateSidebar: mockUpdateSidebar,
          fetchSidebar: mockFetchSidebar,
        }
        return selector ? selector(state) : state
      })

      const { result } = renderHook(() => useFilterOperations())

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.deleteFilter('filter-1')
      })

      // Should still succeed since the API call goes through
      expect(success).toBe(true)
      expect(mockSetSidebarOptimistic).not.toHaveBeenCalled()
      expect(mockStoreDeleteFilter).toHaveBeenCalledWith('filter-1')
    })
  })

  describe('optimistic update ordering', () => {
    it('applies optimistic update before API call for delete', async () => {
      const callOrder: string[] = []

      mockSetSidebarOptimistic.mockImplementation(() => {
        callOrder.push('optimistic')
      })

      mockStoreDeleteFilter.mockImplementation(() => {
        callOrder.push('api')
        return Promise.resolve()
      })

      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.deleteFilter('filter-1')
      })

      expect(callOrder).toEqual(['optimistic', 'api'])
    })

    it('applies optimistic update before API call for update', async () => {
      const callOrder: string[] = []

      mockSetSidebarOptimistic.mockImplementation(() => {
        callOrder.push('optimistic')
      })

      mockStoreUpdateFilter.mockImplementation(() => {
        callOrder.push('api')
        return Promise.resolve(mockFilter)
      })

      const { result } = renderHook(() => useFilterOperations())

      await act(async () => {
        await result.current.updateFilter('filter-1', { name: 'New Name' })
      })

      expect(callOrder).toEqual(['optimistic', 'api'])
    })
  })
})
