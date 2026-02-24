/**
 * Tests for useUIPreferencesStore.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIPreferencesStore, DEFAULT_VIEW_FILTERS } from './uiPreferencesStore'

describe('useUIPreferencesStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIPreferencesStore.setState({
      fullWidthLayout: true,
      bookmarkSortBy: 'last_used_at',
      bookmarkSortOrder: 'desc',
      sortOverrides: {},
      viewFilters: {},
    })
  })

  describe('initial state', () => {
    it('has fullWidthLayout as true by default', () => {
      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(true)
    })
  })

  describe('toggleFullWidthLayout', () => {
    it('toggles from true to false', () => {
      const { toggleFullWidthLayout } = useUIPreferencesStore.getState()
      toggleFullWidthLayout()

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(false)
    })

    it('toggles from false to true', () => {
      useUIPreferencesStore.setState({ fullWidthLayout: false })
      const { toggleFullWidthLayout } = useUIPreferencesStore.getState()
      toggleFullWidthLayout()

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(true)
    })

    it('toggles multiple times', () => {
      const { toggleFullWidthLayout } = useUIPreferencesStore.getState()

      toggleFullWidthLayout()
      expect(useUIPreferencesStore.getState().fullWidthLayout).toBe(false)

      toggleFullWidthLayout()
      expect(useUIPreferencesStore.getState().fullWidthLayout).toBe(true)

      toggleFullWidthLayout()
      expect(useUIPreferencesStore.getState().fullWidthLayout).toBe(false)
    })
  })

  describe('setFullWidthLayout', () => {
    it('sets to true', () => {
      const { setFullWidthLayout } = useUIPreferencesStore.getState()
      setFullWidthLayout(true)

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(true)
    })

    it('sets to false', () => {
      useUIPreferencesStore.setState({ fullWidthLayout: true })
      const { setFullWidthLayout } = useUIPreferencesStore.getState()
      setFullWidthLayout(false)

      const { fullWidthLayout } = useUIPreferencesStore.getState()
      expect(fullWidthLayout).toBe(false)
    })
  })

  describe('sortOverrides', () => {
    describe('initial state', () => {
      it('has empty sortOverrides by default', () => {
        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides).toEqual({})
      })

      it('has default bookmarkSortBy as last_used_at', () => {
        const { bookmarkSortBy } = useUIPreferencesStore.getState()
        expect(bookmarkSortBy).toBe('last_used_at')
      })

      it('has default bookmarkSortOrder as desc', () => {
        const { bookmarkSortOrder } = useUIPreferencesStore.getState()
        expect(bookmarkSortOrder).toBe('desc')
      })
    })

    describe('setSortOverride', () => {
      it('sets override for a specific view key', () => {
        const { setSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides['all']).toEqual({
          sortBy: 'created_at',
          sortOrder: 'asc',
        })
      })

      it('sets override for list view key', () => {
        const { setSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('list:5', 'title', 'asc')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides['list:5']).toEqual({
          sortBy: 'title',
          sortOrder: 'asc',
        })
      })

      it('sets multiple overrides for different views', () => {
        const { setSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'desc')
        setSortOverride('archived', 'archived_at', 'desc')
        setSortOverride('trash', 'deleted_at', 'desc')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(Object.keys(sortOverrides)).toHaveLength(3)
        expect(sortOverrides['all']).toEqual({ sortBy: 'created_at', sortOrder: 'desc' })
        expect(sortOverrides['archived']).toEqual({ sortBy: 'archived_at', sortOrder: 'desc' })
        expect(sortOverrides['trash']).toEqual({ sortBy: 'deleted_at', sortOrder: 'desc' })
      })

      it('overwrites existing override for same view key', () => {
        const { setSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')
        setSortOverride('all', 'updated_at', 'desc')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides['all']).toEqual({
          sortBy: 'updated_at',
          sortOrder: 'desc',
        })
      })
    })

    describe('clearSortOverride', () => {
      it('clears override for a specific view key', () => {
        const { setSortOverride, clearSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')
        clearSortOverride('all')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides['all']).toBeUndefined()
      })

      it('does not affect other view keys when clearing one', () => {
        const { setSortOverride, clearSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')
        setSortOverride('list:5', 'title', 'asc')
        clearSortOverride('all')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides['all']).toBeUndefined()
        expect(sortOverrides['list:5']).toEqual({ sortBy: 'title', sortOrder: 'asc' })
      })

      it('handles clearing non-existent key gracefully', () => {
        const { clearSortOverride } = useUIPreferencesStore.getState()
        clearSortOverride('nonexistent')

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides).toEqual({})
      })
    })

    describe('clearAllSortOverrides', () => {
      it('clears all sort overrides', () => {
        const { setSortOverride, clearAllSortOverrides } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')
        setSortOverride('archived', 'archived_at', 'desc')
        setSortOverride('list:5', 'title', 'asc')

        clearAllSortOverrides()

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides).toEqual({})
      })

      it('handles clearing when already empty', () => {
        const { clearAllSortOverrides } = useUIPreferencesStore.getState()
        clearAllSortOverrides()

        const { sortOverrides } = useUIPreferencesStore.getState()
        expect(sortOverrides).toEqual({})
      })
    })

    describe('getSortOverride', () => {
      it('returns override for existing view key', () => {
        const { setSortOverride, getSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')

        const override = getSortOverride('all')
        expect(override).toEqual({ sortBy: 'created_at', sortOrder: 'asc' })
      })

      it('returns undefined for non-existent view key', () => {
        const { getSortOverride } = useUIPreferencesStore.getState()
        const override = getSortOverride('nonexistent')
        expect(override).toBeUndefined()
      })

      it('returns correct override after updates', () => {
        const { setSortOverride, getSortOverride } = useUIPreferencesStore.getState()
        setSortOverride('all', 'created_at', 'asc')
        setSortOverride('all', 'title', 'desc')

        const override = getSortOverride('all')
        expect(override).toEqual({ sortBy: 'title', sortOrder: 'desc' })
      })
    })
  })

  describe('viewFilters', () => {
    describe('getViewFilters', () => {
      it('returns DEFAULT_VIEW_FILTERS when no override is set', () => {
        const { getViewFilters } = useUIPreferencesStore.getState()
        expect(getViewFilters('palette-search')).toEqual(DEFAULT_VIEW_FILTERS)
      })

      it('returns stored filters when set', () => {
        useUIPreferencesStore.setState({ viewFilters: { 'palette-search': ['active'] } })
        const { getViewFilters } = useUIPreferencesStore.getState()
        expect(getViewFilters('palette-search')).toEqual(['active'])
      })

      it('returns DEFAULT_VIEW_FILTERS for unset key even when other keys exist', () => {
        useUIPreferencesStore.setState({ viewFilters: { 'other-view': ['archived'] } })
        const { getViewFilters } = useUIPreferencesStore.getState()
        expect(getViewFilters('palette-search')).toEqual(DEFAULT_VIEW_FILTERS)
      })
    })

    describe('toggleViewFilter', () => {
      it('removes a filter when it is currently selected', () => {
        const { toggleViewFilter, getViewFilters } = useUIPreferencesStore.getState()
        toggleViewFilter('test', 'archived')
        expect(getViewFilters('test')).toEqual(['active'])
      })

      it('adds a filter when it is not currently selected', () => {
        useUIPreferencesStore.setState({ viewFilters: { test: ['active'] } })
        const { toggleViewFilter, getViewFilters } = useUIPreferencesStore.getState()
        toggleViewFilter('test', 'archived')
        expect(getViewFilters('test')).toContain('active')
        expect(getViewFilters('test')).toContain('archived')
      })

      it('prevents deselecting the last filter', () => {
        useUIPreferencesStore.setState({ viewFilters: { test: ['active'] } })
        const { toggleViewFilter, getViewFilters } = useUIPreferencesStore.getState()
        toggleViewFilter('test', 'active')
        expect(getViewFilters('test')).toEqual(['active'])
      })

      it('does not affect other view keys', () => {
        useUIPreferencesStore.setState({ viewFilters: { a: ['active', 'archived'], b: ['archived'] } })
        const { toggleViewFilter, getViewFilters } = useUIPreferencesStore.getState()
        toggleViewFilter('a', 'archived')
        expect(getViewFilters('a')).toEqual(['active'])
        expect(getViewFilters('b')).toEqual(['archived'])
      })
    })

    describe('clearViewFilters', () => {
      it('removes the key so getViewFilters returns default', () => {
        useUIPreferencesStore.setState({ viewFilters: { test: ['active'] } })
        const { clearViewFilters, getViewFilters } = useUIPreferencesStore.getState()
        clearViewFilters('test')
        expect(getViewFilters('test')).toEqual(DEFAULT_VIEW_FILTERS)
      })

      it('does not affect other view keys', () => {
        useUIPreferencesStore.setState({ viewFilters: { a: ['active'], b: ['archived'] } })
        const { clearViewFilters, getViewFilters } = useUIPreferencesStore.getState()
        clearViewFilters('a')
        expect(getViewFilters('a')).toEqual(DEFAULT_VIEW_FILTERS)
        expect(getViewFilters('b')).toEqual(['archived'])
      })

      it('handles clearing non-existent key gracefully', () => {
        const { clearViewFilters } = useUIPreferencesStore.getState()
        clearViewFilters('nonexistent')
        expect(useUIPreferencesStore.getState().viewFilters).toEqual({})
      })
    })
  })
})
