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
      expect(selectedTypes['all']).toEqual(['bookmark'])
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
      expect(getSelectedTypes('all')).toEqual(['bookmark'])

      // Toggle note back on
      toggleType('all', 'note')
      expect(getSelectedTypes('all')).toContain('bookmark')
      expect(getSelectedTypes('all')).toContain('note')

      // Toggle off bookmark
      toggleType('all', 'bookmark')
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
    it('contains bookmark and note types', () => {
      expect(ALL_CONTENT_TYPES).toContain('bookmark')
      expect(ALL_CONTENT_TYPES).toContain('note')
    })

    it('has exactly 2 types', () => {
      expect(ALL_CONTENT_TYPES).toHaveLength(2)
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
})
