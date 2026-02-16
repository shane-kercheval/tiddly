/**
 * Tests for useTagFilterStore (view-keyed).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useTagFilterStore } from './tagFilterStore'

describe('useTagFilterStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTagFilterStore.setState({
      selectedTags: {},
      tagMatch: {},
    })
  })

  describe('initial state', () => {
    it('returns empty tags for uninitialized view', () => {
      const { getSelectedTags } = useTagFilterStore.getState()
      expect(getSelectedTags('active')).toEqual([])
    })

    it('returns "all" tag match for uninitialized view', () => {
      const { getTagMatch } = useTagFilterStore.getState()
      expect(getTagMatch('active')).toBe('all')
    })
  })

  describe('addTag', () => {
    it('adds a tag to a view', () => {
      const { addTag, getSelectedTags } = useTagFilterStore.getState()
      addTag('active', 'javascript')

      expect(getSelectedTags('active')).toEqual(['javascript'])
    })

    it('does not add duplicate tags', () => {
      const { addTag, getSelectedTags } = useTagFilterStore.getState()
      addTag('active', 'javascript')
      addTag('active', 'javascript')

      expect(getSelectedTags('active')).toEqual(['javascript'])
    })

    it('adds multiple different tags', () => {
      const { addTag, getSelectedTags } = useTagFilterStore.getState()
      addTag('active', 'javascript')
      addTag('active', 'react')
      addTag('active', 'typescript')

      expect(getSelectedTags('active')).toEqual(['javascript', 'react', 'typescript'])
    })
  })

  describe('removeTag', () => {
    it('removes a tag from a view', () => {
      useTagFilterStore.setState({ selectedTags: { active: ['javascript', 'react'] } })
      const { removeTag, getSelectedTags } = useTagFilterStore.getState()
      removeTag('active', 'javascript')

      expect(getSelectedTags('active')).toEqual(['react'])
    })

    it('does nothing when removing non-existent tag', () => {
      useTagFilterStore.setState({ selectedTags: { active: ['javascript'] } })
      const { removeTag, getSelectedTags } = useTagFilterStore.getState()
      removeTag('active', 'nonexistent')

      expect(getSelectedTags('active')).toEqual(['javascript'])
    })
  })

  describe('setTags', () => {
    it('replaces all tags for a view', () => {
      useTagFilterStore.setState({ selectedTags: { active: ['old'] } })
      const { setTags, getSelectedTags } = useTagFilterStore.getState()
      setTags('active', ['new1', 'new2'])

      expect(getSelectedTags('active')).toEqual(['new1', 'new2'])
    })

    it('can clear all tags with empty array', () => {
      useTagFilterStore.setState({ selectedTags: { active: ['tag1', 'tag2'] } })
      const { setTags, getSelectedTags } = useTagFilterStore.getState()
      setTags('active', [])

      expect(getSelectedTags('active')).toEqual([])
    })
  })

  describe('setTagMatch', () => {
    it('sets tag match for a view', () => {
      const { setTagMatch, getTagMatch } = useTagFilterStore.getState()
      setTagMatch('active', 'any')

      expect(getTagMatch('active')).toBe('any')
    })

    it('sets tag match back to "all"', () => {
      useTagFilterStore.setState({ tagMatch: { active: 'any' } })
      const { setTagMatch, getTagMatch } = useTagFilterStore.getState()
      setTagMatch('active', 'all')

      expect(getTagMatch('active')).toBe('all')
    })
  })

  describe('clearFilters', () => {
    it('clears selected tags and tag match for a view', () => {
      useTagFilterStore.setState({
        selectedTags: { active: ['tag1', 'tag2'], search: ['other'] },
        tagMatch: { active: 'any', search: 'all' },
      })
      const { clearFilters, getSelectedTags, getTagMatch } = useTagFilterStore.getState()
      clearFilters('active')

      expect(getSelectedTags('active')).toEqual([])
      expect(getTagMatch('active')).toBe('all')
      // Other views unaffected
      expect(getSelectedTags('search')).toEqual(['other'])
    })
  })

  describe('view isolation', () => {
    it('tags in one view do not appear in another', () => {
      const { addTag, getSelectedTags } = useTagFilterStore.getState()
      addTag('active', 'javascript')
      addTag('search', 'python')

      expect(getSelectedTags('active')).toEqual(['javascript'])
      expect(getSelectedTags('search')).toEqual(['python'])
    })

    it('clearing one view does not affect another', () => {
      useTagFilterStore.setState({
        selectedTags: { active: ['tag1'], search: ['tag2'] },
        tagMatch: { active: 'any', search: 'any' },
      })
      const { clearFilters, getSelectedTags, getTagMatch } = useTagFilterStore.getState()
      clearFilters('active')

      expect(getSelectedTags('active')).toEqual([])
      expect(getTagMatch('active')).toBe('all')
      expect(getSelectedTags('search')).toEqual(['tag2'])
      expect(getTagMatch('search')).toBe('any')
    })
  })

  describe('renameTagAllViews', () => {
    it('renames a tag across all views', () => {
      useTagFilterStore.setState({
        selectedTags: {
          active: ['javascript', 'react'],
          search: ['javascript', 'python'],
          archived: ['typescript'],
        },
      })
      const { renameTagAllViews, getSelectedTags } = useTagFilterStore.getState()
      renameTagAllViews('javascript', 'js')

      expect(getSelectedTags('active')).toEqual(['js', 'react'])
      expect(getSelectedTags('search')).toEqual(['js', 'python'])
      expect(getSelectedTags('archived')).toEqual(['typescript'])
    })

    it('does nothing when tag not present in any view', () => {
      useTagFilterStore.setState({
        selectedTags: { active: ['javascript'] },
      })
      const { renameTagAllViews, getSelectedTags } = useTagFilterStore.getState()
      renameTagAllViews('nonexistent', 'something')

      expect(getSelectedTags('active')).toEqual(['javascript'])
    })

    it('preserves tag order when renaming', () => {
      useTagFilterStore.setState({
        selectedTags: { active: ['first', 'middle', 'last'] },
      })
      const { renameTagAllViews, getSelectedTags } = useTagFilterStore.getState()
      renameTagAllViews('middle', 'center')

      expect(getSelectedTags('active')).toEqual(['first', 'center', 'last'])
    })
  })

  describe('removeTagAllViews', () => {
    it('removes a tag from all views', () => {
      useTagFilterStore.setState({
        selectedTags: {
          active: ['javascript', 'react'],
          search: ['javascript', 'python'],
          archived: ['typescript'],
        },
      })
      const { removeTagAllViews, getSelectedTags } = useTagFilterStore.getState()
      removeTagAllViews('javascript')

      expect(getSelectedTags('active')).toEqual(['react'])
      expect(getSelectedTags('search')).toEqual(['python'])
      expect(getSelectedTags('archived')).toEqual(['typescript'])
    })

    it('does nothing when tag not present in any view', () => {
      useTagFilterStore.setState({
        selectedTags: { active: ['javascript'] },
      })
      const { removeTagAllViews, getSelectedTags } = useTagFilterStore.getState()
      removeTagAllViews('nonexistent')

      expect(getSelectedTags('active')).toEqual(['javascript'])
    })
  })
})
