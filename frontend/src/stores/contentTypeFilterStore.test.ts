/**
 * Tests for useContentTypeFilterStore.
 *
 * Tests the content type filter state management for All/Archived/Trash views.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useContentTypeFilterStore, ALL_CONTENT_TYPES } from './contentTypeFilterStore'

describe('useContentTypeFilterStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useContentTypeFilterStore.setState({
      selectedTypes: {},
    })
  })

  describe('initial state', () => {
    it('has empty selectedTypes by default', () => {
      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes).toEqual({})
    })
  })

  describe('getSelectedTypes', () => {
    it('returns all content types when view has no selection', () => {
      const { getSelectedTypes } = useContentTypeFilterStore.getState()
      const types = getSelectedTypes('all')
      expect(types).toEqual(ALL_CONTENT_TYPES)
    })

    it('returns all content types when view has empty array', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { all: [] },
      })
      const { getSelectedTypes } = useContentTypeFilterStore.getState()
      const types = getSelectedTypes('all')
      expect(types).toEqual(ALL_CONTENT_TYPES)
    })

    it('returns selected types for a view', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { all: ['bookmark'] },
      })
      const { getSelectedTypes } = useContentTypeFilterStore.getState()
      const types = getSelectedTypes('all')
      expect(types).toEqual(['bookmark'])
    })

    it('returns correct types for different views', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: {
          all: ['bookmark'],
          archived: ['note'],
          deleted: ['bookmark', 'note'],
        },
      })
      const { getSelectedTypes } = useContentTypeFilterStore.getState()

      expect(getSelectedTypes('all')).toEqual(['bookmark'])
      expect(getSelectedTypes('archived')).toEqual(['note'])
      expect(getSelectedTypes('deleted')).toEqual(['bookmark', 'note'])
    })
  })

  describe('toggleType', () => {
    it('adds type when not selected', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { all: ['bookmark'] },
      })
      const { toggleType } = useContentTypeFilterStore.getState()
      toggleType('all', 'note')

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toContain('bookmark')
      expect(selectedTypes['all']).toContain('note')
    })

    it('removes type when already selected', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { all: ['bookmark', 'note'] },
      })
      const { toggleType } = useContentTypeFilterStore.getState()
      toggleType('all', 'note')

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['bookmark'])
    })

    it('prevents deselecting the last type', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { all: ['bookmark'] },
      })
      const { toggleType } = useContentTypeFilterStore.getState()
      toggleType('all', 'bookmark')

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['bookmark'])
    })

    it('initializes with all types when view has no prior selection', () => {
      const { toggleType } = useContentTypeFilterStore.getState()
      toggleType('all', 'note')

      const { selectedTypes } = useContentTypeFilterStore.getState()
      // Should have all types except 'note' (which was toggled off from the initial all-selected state)
      expect(selectedTypes['all']).toEqual(['bookmark', 'prompt'])
    })

    it('does not affect other views when toggling one view', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: {
          all: ['bookmark', 'note'],
          archived: ['bookmark'],
        },
      })
      const { toggleType } = useContentTypeFilterStore.getState()
      toggleType('all', 'note')

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['bookmark'])
      expect(selectedTypes['archived']).toEqual(['bookmark'])
    })

    it('handles multiple toggle operations correctly', () => {
      const { toggleType, getSelectedTypes } = useContentTypeFilterStore.getState()

      // Start with default (all types)
      expect(getSelectedTypes('all')).toEqual(ALL_CONTENT_TYPES)

      // Toggle off note
      toggleType('all', 'note')
      expect(getSelectedTypes('all')).toEqual(['bookmark', 'prompt'])

      // Toggle note back on
      toggleType('all', 'note')
      expect(getSelectedTypes('all')).toContain('bookmark')
      expect(getSelectedTypes('all')).toContain('note')
      expect(getSelectedTypes('all')).toContain('prompt')

      // Toggle off bookmark
      toggleType('all', 'bookmark')
      expect(getSelectedTypes('all')).toContain('note')
      expect(getSelectedTypes('all')).toContain('prompt')

      // Toggle off prompt too
      toggleType('all', 'prompt')
      expect(getSelectedTypes('all')).toEqual(['note'])

      // Try to toggle off note (should be prevented - last type)
      toggleType('all', 'note')
      expect(getSelectedTypes('all')).toEqual(['note'])
    })
  })

  describe('setTypes', () => {
    it('sets types directly for a view', () => {
      const { setTypes } = useContentTypeFilterStore.getState()
      setTypes('all', ['bookmark'])

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['bookmark'])
    })

    it('sets multiple types for a view', () => {
      const { setTypes } = useContentTypeFilterStore.getState()
      setTypes('all', ['bookmark', 'note'])

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['bookmark', 'note'])
    })

    it('falls back to all types when setting empty array', () => {
      const { setTypes, getSelectedTypes } = useContentTypeFilterStore.getState()
      setTypes('all', [])

      // getSelectedTypes should return all types for empty selection
      expect(getSelectedTypes('all')).toEqual(ALL_CONTENT_TYPES)
    })

    it('does not affect other views when setting one view', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { archived: ['note'] },
      })
      const { setTypes } = useContentTypeFilterStore.getState()
      setTypes('all', ['bookmark'])

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['bookmark'])
      expect(selectedTypes['archived']).toEqual(['note'])
    })

    it('overwrites existing selection', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { all: ['bookmark', 'note'] },
      })
      const { setTypes } = useContentTypeFilterStore.getState()
      setTypes('all', ['note'])

      const { selectedTypes } = useContentTypeFilterStore.getState()
      expect(selectedTypes['all']).toEqual(['note'])
    })
  })

  describe('ALL_CONTENT_TYPES constant', () => {
    it('contains bookmark, note, and prompt types', () => {
      expect(ALL_CONTENT_TYPES).toContain('bookmark')
      expect(ALL_CONTENT_TYPES).toContain('note')
      expect(ALL_CONTENT_TYPES).toContain('prompt')
    })

    it('has exactly 3 types', () => {
      expect(ALL_CONTENT_TYPES).toHaveLength(3)
    })
  })

  describe('view isolation', () => {
    it('maintains separate state for each view', () => {
      const { setTypes, getSelectedTypes } = useContentTypeFilterStore.getState()

      setTypes('all', ['bookmark'])
      setTypes('archived', ['note'])
      setTypes('deleted', ['bookmark', 'note'])

      expect(getSelectedTypes('all')).toEqual(['bookmark'])
      expect(getSelectedTypes('archived')).toEqual(['note'])
      expect(getSelectedTypes('deleted')).toEqual(['bookmark', 'note'])
    })

    it('does not share state between views', () => {
      const { toggleType, getSelectedTypes } = useContentTypeFilterStore.getState()

      // Toggle in 'all' view
      toggleType('all', 'note')

      // 'archived' view should still have default (all types)
      expect(getSelectedTypes('archived')).toEqual(ALL_CONTENT_TYPES)
    })
  })

  describe('clearTypes', () => {
    it('removes the view key so getSelectedTypes returns all types', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { search: ['bookmark'] },
      })
      const { clearTypes, getSelectedTypes } = useContentTypeFilterStore.getState()
      clearTypes('search')
      expect(getSelectedTypes('search')).toEqual(ALL_CONTENT_TYPES)
    })

    it('does not affect other view keys', () => {
      useContentTypeFilterStore.setState({
        selectedTypes: { search: ['bookmark'], all: ['note'] },
      })
      const { clearTypes, getSelectedTypes } = useContentTypeFilterStore.getState()
      clearTypes('search')
      expect(getSelectedTypes('search')).toEqual(ALL_CONTENT_TYPES)
      expect(getSelectedTypes('all')).toEqual(['note'])
    })

    it('handles clearing non-existent key gracefully', () => {
      const { clearTypes } = useContentTypeFilterStore.getState()
      clearTypes('nonexistent')
      expect(useContentTypeFilterStore.getState().selectedTypes).toEqual({})
    })
  })

  describe('migration', () => {
    it('migrates v1 state to v2 by adding prompt to existing selections', () => {
      // Simulate v1 persisted state (no prompt type)
      const v1State = {
        selectedTypes: {
          all: ['bookmark', 'note'],
          archived: ['bookmark'],
          deleted: ['note'],
        },
      }

      // Get the persist config to access migrate function
      const persistConfig = (useContentTypeFilterStore as unknown as {
        persist: { getOptions: () => { migrate: (state: unknown, version: number) => unknown } }
      }).persist.getOptions()

      // Run migration from version 1 to version 2
      const migratedState = persistConfig.migrate(v1State, 1) as {
        selectedTypes: Record<string, string[]>
      }

      // All views should have 'prompt' added
      expect(migratedState.selectedTypes['all']).toContain('bookmark')
      expect(migratedState.selectedTypes['all']).toContain('note')
      expect(migratedState.selectedTypes['all']).toContain('prompt')
      expect(migratedState.selectedTypes['archived']).toContain('bookmark')
      expect(migratedState.selectedTypes['archived']).toContain('prompt')
      expect(migratedState.selectedTypes['deleted']).toContain('note')
      expect(migratedState.selectedTypes['deleted']).toContain('prompt')
    })

    it('does not duplicate prompt if already present in v1 state', () => {
      // Edge case: v1 state somehow has prompt already
      const v1State = {
        selectedTypes: {
          all: ['bookmark', 'note', 'prompt'],
        },
      }

      const persistConfig = (useContentTypeFilterStore as unknown as {
        persist: { getOptions: () => { migrate: (state: unknown, version: number) => unknown } }
      }).persist.getOptions()

      const migratedState = persistConfig.migrate(v1State, 1) as {
        selectedTypes: Record<string, string[]>
      }

      // Should not have duplicate prompts
      const promptCount = migratedState.selectedTypes['all'].filter((t) => t === 'prompt').length
      expect(promptCount).toBe(1)
    })

    it('does not modify v2 state during migration', () => {
      const v2State = {
        selectedTypes: {
          all: ['bookmark'],
        },
      }

      const persistConfig = (useContentTypeFilterStore as unknown as {
        persist: { getOptions: () => { migrate: (state: unknown, version: number) => unknown } }
      }).persist.getOptions()

      // Migrating from v2 should not modify state
      const migratedState = persistConfig.migrate(v2State, 2) as {
        selectedTypes: Record<string, string[]>
      }

      expect(migratedState.selectedTypes['all']).toEqual(['bookmark'])
    })

    it('handles empty state during migration', () => {
      const emptyState = { selectedTypes: {} }

      const persistConfig = (useContentTypeFilterStore as unknown as {
        persist: { getOptions: () => { migrate: (state: unknown, version: number) => unknown } }
      }).persist.getOptions()

      const migratedState = persistConfig.migrate(emptyState, 1) as {
        selectedTypes: Record<string, string[]>
      }

      expect(migratedState.selectedTypes).toEqual({})
    })

    it('handles null/undefined state during migration', () => {
      const persistConfig = (useContentTypeFilterStore as unknown as {
        persist: { getOptions: () => { migrate: (state: unknown, version: number) => unknown } }
      }).persist.getOptions()

      // Should not throw on null state
      expect(() => persistConfig.migrate(null, 1)).not.toThrow()
      expect(() => persistConfig.migrate(undefined, 1)).not.toThrow()
    })
  })
})
