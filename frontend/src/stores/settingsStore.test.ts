/**
 * Tests for useSettingsStore optimistic update functionality.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { useSettingsStore } from './settingsStore'
import { api } from '../services/api'
import type { SidebarOrderComputed, SidebarItemComputed } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

const mockApiGet = api.get as Mock
const mockApiPut = api.put as Mock

// Sample sidebar data for tests
const createMockSidebar = (): SidebarOrderComputed => ({
  version: 1,
  items: [
    { type: 'builtin', key: 'all', name: 'All Content' },
    { type: 'filter', id: '1', name: 'Test Filter', content_types: ['bookmark'] },
    {
      type: 'collection',
      id: 'collection-1',
      name: 'Test Collection',
      items: [
        { type: 'filter', id: '2', name: 'Nested Filter', content_types: ['note'] },
      ],
    },
  ],
})

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state before each test
    useSettingsStore.setState({
      sidebar: null,
      _previousSidebar: null,
      isLoading: false,
      error: null,
    })
  })

  describe('initial state', () => {
    it('has null sidebar initially', () => {
      const state = useSettingsStore.getState()
      expect(state.sidebar).toBeNull()
      expect(state._previousSidebar).toBeNull()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })
  })

  describe('fetchSidebar', () => {
    it('fetches sidebar and updates state', async () => {
      const mockSidebar = createMockSidebar()
      mockApiGet.mockResolvedValueOnce({ data: mockSidebar })

      const { fetchSidebar } = useSettingsStore.getState()
      await fetchSidebar()

      const state = useSettingsStore.getState()
      expect(state.sidebar).toEqual(mockSidebar)
      expect(state.isLoading).toBe(false)
      expect(mockApiGet).toHaveBeenCalledWith('/settings/sidebar')
    })

    it('sets error on API failure', async () => {
      mockApiGet.mockRejectedValueOnce(new Error('Network error'))

      const { fetchSidebar } = useSettingsStore.getState()
      await fetchSidebar()

      const state = useSettingsStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.isLoading).toBe(false)
    })
  })

  describe('setSidebarOptimistic', () => {
    it('updates sidebar items optimistically and stores previous state', () => {
      const mockSidebar = createMockSidebar()
      useSettingsStore.setState({ sidebar: mockSidebar })

      const newItems: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
      ]

      const { setSidebarOptimistic } = useSettingsStore.getState()
      setSidebarOptimistic(newItems)

      const state = useSettingsStore.getState()
      expect(state.sidebar?.items).toEqual(newItems)
      expect(state._previousSidebar).toEqual(mockSidebar)
    })

    it('preserves first previous state on multiple optimistic updates', () => {
      const originalSidebar = createMockSidebar()
      useSettingsStore.setState({ sidebar: originalSidebar })

      const { setSidebarOptimistic } = useSettingsStore.getState()

      // First optimistic update
      const firstUpdate: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
      ]
      setSidebarOptimistic(firstUpdate)

      // Second optimistic update (should keep original as _previousSidebar)
      const secondUpdate: SidebarItemComputed[] = [
        { type: 'builtin', key: 'archived', name: 'Archived' },
      ]
      setSidebarOptimistic(secondUpdate)

      const state = useSettingsStore.getState()
      expect(state.sidebar?.items).toEqual(secondUpdate)
      // Should still have the original sidebar, not the first update
      expect(state._previousSidebar).toEqual(originalSidebar)
    })

    it('does nothing if sidebar is null', () => {
      const { setSidebarOptimistic } = useSettingsStore.getState()
      const newItems: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
      ]
      setSidebarOptimistic(newItems)

      const state = useSettingsStore.getState()
      expect(state.sidebar).toBeNull()
    })
  })

  describe('rollbackSidebar', () => {
    it('restores previous sidebar state', () => {
      const originalSidebar = createMockSidebar()
      const modifiedItems: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
      ]

      useSettingsStore.setState({
        sidebar: { version: 1, items: modifiedItems },
        _previousSidebar: originalSidebar,
      })

      const { rollbackSidebar } = useSettingsStore.getState()
      rollbackSidebar()

      const state = useSettingsStore.getState()
      expect(state.sidebar).toEqual(originalSidebar)
      expect(state._previousSidebar).toBeNull()
    })

    it('does nothing if no previous state exists', () => {
      const currentSidebar = createMockSidebar()
      useSettingsStore.setState({
        sidebar: currentSidebar,
        _previousSidebar: null,
      })

      const { rollbackSidebar } = useSettingsStore.getState()
      rollbackSidebar()

      const state = useSettingsStore.getState()
      expect(state.sidebar).toEqual(currentSidebar)
    })
  })

  describe('updateSidebar', () => {
    it('clears previous sidebar state on successful update', async () => {
      const originalSidebar = createMockSidebar()
      const updatedSidebar: SidebarOrderComputed = {
        version: 1,
        items: [{ type: 'builtin', key: 'all', name: 'All Content' }],
      }

      useSettingsStore.setState({
        sidebar: { version: 1, items: [] },
        _previousSidebar: originalSidebar,
      })

      mockApiPut.mockResolvedValueOnce({})
      mockApiGet.mockResolvedValueOnce({ data: updatedSidebar })

      const { updateSidebar } = useSettingsStore.getState()
      await updateSidebar({ version: 1, items: [] })

      const state = useSettingsStore.getState()
      expect(state._previousSidebar).toBeNull()
      expect(state.sidebar).toEqual(updatedSidebar)
    })

    it('throws error on API failure (allowing caller to handle rollback)', async () => {
      mockApiPut.mockRejectedValueOnce(new Error('API error'))

      const { updateSidebar } = useSettingsStore.getState()

      await expect(updateSidebar({ version: 1, items: [] })).rejects.toThrow('API error')
    })
  })

  describe('optimistic update flow integration', () => {
    it('completes full optimistic create collection flow on success', async () => {
      const originalSidebar = createMockSidebar()
      useSettingsStore.setState({ sidebar: originalSidebar })

      // Simulate creating a new collection
      const newCollection: SidebarItemComputed = {
        type: 'collection',
        id: 'new-group',
        name: 'New Collection',
        items: [],
      }
      const optimisticItems = [newCollection, ...originalSidebar.items]

      // Step 1: Optimistic update
      const { setSidebarOptimistic, updateSidebar } = useSettingsStore.getState()
      setSidebarOptimistic(optimisticItems)

      // Verify optimistic state
      let state = useSettingsStore.getState()
      expect(state.sidebar?.items[0]).toEqual(newCollection)
      expect(state._previousSidebar).toEqual(originalSidebar)

      // Step 2: API call succeeds
      const serverSidebar: SidebarOrderComputed = {
        version: 1,
        items: optimisticItems,
      }
      mockApiPut.mockResolvedValueOnce({})
      mockApiGet.mockResolvedValueOnce({ data: serverSidebar })

      await updateSidebar({ version: 1, items: [] })

      // Verify final state
      state = useSettingsStore.getState()
      expect(state._previousSidebar).toBeNull()
      expect(state.sidebar?.items[0]).toEqual(newCollection)
    })

    it('rolls back on API failure during optimistic update', async () => {
      const originalSidebar = createMockSidebar()
      useSettingsStore.setState({ sidebar: originalSidebar })

      // Simulate creating a new collection
      const newCollection: SidebarItemComputed = {
        type: 'collection',
        id: 'new-group',
        name: 'New Collection',
        items: [],
      }
      const optimisticItems = [newCollection, ...originalSidebar.items]

      // Step 1: Optimistic update
      const { setSidebarOptimistic, updateSidebar, rollbackSidebar } =
        useSettingsStore.getState()
      setSidebarOptimistic(optimisticItems)

      // Verify optimistic state
      let state = useSettingsStore.getState()
      expect(state.sidebar?.items[0]).toEqual(newCollection)

      // Step 2: API call fails
      mockApiPut.mockRejectedValueOnce(new Error('Server error'))

      try {
        await updateSidebar({ version: 1, items: [] })
      } catch {
        // Step 3: Rollback
        rollbackSidebar()
      }

      // Verify rollback
      state = useSettingsStore.getState()
      expect(state.sidebar).toEqual(originalSidebar)
      expect(state._previousSidebar).toBeNull()
    })

    it('handles delete collection optimistic flow', async () => {
      const sidebarWithCollection: SidebarOrderComputed = {
        version: 1,
        items: [
          { type: 'builtin', key: 'all', name: 'All Content' },
          {
            type: 'collection',
            id: 'collection-to-delete',
            name: 'Collection to Delete',
            items: [
              { type: 'filter', id: '1', name: 'Filter 1', content_types: ['bookmark'] },
            ],
          },
        ],
      }
      useSettingsStore.setState({ sidebar: sidebarWithCollection })

      // Simulate deleting group (items move to root)
      const optimisticItems: SidebarItemComputed[] = [
        { type: 'builtin', key: 'all', name: 'All Content' },
        { type: 'filter', id: '1', name: 'Filter 1', content_types: ['bookmark'] },
      ]

      const { setSidebarOptimistic } = useSettingsStore.getState()
      setSidebarOptimistic(optimisticItems)

      const state = useSettingsStore.getState()
      // Collection should be gone, filter should be at root
      expect(state.sidebar?.items).toHaveLength(2)
      expect(state.sidebar?.items.find((i) => i.type === 'collection')).toBeUndefined()
      expect(state.sidebar?.items.find((i) => i.type === 'filter')).toBeDefined()
      // Previous state should be stored for rollback
      expect(state._previousSidebar).toEqual(sidebarWithCollection)
    })

    it('handles rename collection optimistic flow', async () => {
      const sidebarWithCollection: SidebarOrderComputed = {
        version: 1,
        items: [
          {
            type: 'collection',
            id: 'collection-1',
            name: 'Original Name',
            items: [],
          },
        ],
      }
      useSettingsStore.setState({ sidebar: sidebarWithCollection })

      // Simulate renaming collection
      const optimisticItems: SidebarItemComputed[] = [
        {
          type: 'collection',
          id: 'collection-1',
          name: 'New Name',
          items: [],
        },
      ]

      const { setSidebarOptimistic } = useSettingsStore.getState()
      setSidebarOptimistic(optimisticItems)

      const state = useSettingsStore.getState()
      const collection = state.sidebar?.items[0]
      expect(collection?.type).toBe('collection')
      if (collection?.type === 'collection') {
        expect(collection.name).toBe('New Name')
      }
      // Previous state should be stored for rollback
      expect(state._previousSidebar?.items[0]).toEqual({
        type: 'collection',
        id: 'collection-1',
        name: 'Original Name',
        items: [],
      })
    })
  })
})
