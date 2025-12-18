/**
 * Tests for useTagFilterStore.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useTagFilterStore } from './tagFilterStore'

describe('useTagFilterStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTagFilterStore.setState({
      selectedTags: [],
      tagMatch: 'all',
    })
  })

  describe('initial state', () => {
    it('has empty selected tags by default', () => {
      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual([])
    })

    it('has "all" tag match by default', () => {
      const { tagMatch } = useTagFilterStore.getState()
      expect(tagMatch).toBe('all')
    })
  })

  describe('addTag', () => {
    it('adds a tag to selected tags', () => {
      const { addTag } = useTagFilterStore.getState()
      addTag('javascript')

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual(['javascript'])
    })

    it('does not add duplicate tags', () => {
      const { addTag } = useTagFilterStore.getState()
      addTag('javascript')
      addTag('javascript')

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual(['javascript'])
    })

    it('adds multiple different tags', () => {
      const { addTag } = useTagFilterStore.getState()
      addTag('javascript')
      addTag('react')
      addTag('typescript')

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual(['javascript', 'react', 'typescript'])
    })
  })

  describe('removeTag', () => {
    it('removes a tag from selected tags', () => {
      useTagFilterStore.setState({ selectedTags: ['javascript', 'react'] })
      const { removeTag } = useTagFilterStore.getState()
      removeTag('javascript')

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual(['react'])
    })

    it('does nothing when removing non-existent tag', () => {
      useTagFilterStore.setState({ selectedTags: ['javascript'] })
      const { removeTag } = useTagFilterStore.getState()
      removeTag('nonexistent')

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual(['javascript'])
    })
  })

  describe('setTags', () => {
    it('replaces all selected tags', () => {
      useTagFilterStore.setState({ selectedTags: ['old'] })
      const { setTags } = useTagFilterStore.getState()
      setTags(['new1', 'new2'])

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual(['new1', 'new2'])
    })

    it('can clear all tags with empty array', () => {
      useTagFilterStore.setState({ selectedTags: ['tag1', 'tag2'] })
      const { setTags } = useTagFilterStore.getState()
      setTags([])

      const { selectedTags } = useTagFilterStore.getState()
      expect(selectedTags).toEqual([])
    })
  })

  describe('setTagMatch', () => {
    it('sets tag match to "any"', () => {
      const { setTagMatch } = useTagFilterStore.getState()
      setTagMatch('any')

      const { tagMatch } = useTagFilterStore.getState()
      expect(tagMatch).toBe('any')
    })

    it('sets tag match back to "all"', () => {
      useTagFilterStore.setState({ tagMatch: 'any' })
      const { setTagMatch } = useTagFilterStore.getState()
      setTagMatch('all')

      const { tagMatch } = useTagFilterStore.getState()
      expect(tagMatch).toBe('all')
    })
  })

  describe('clearFilters', () => {
    it('clears selected tags and resets tag match', () => {
      useTagFilterStore.setState({
        selectedTags: ['tag1', 'tag2'],
        tagMatch: 'any',
      })
      const { clearFilters } = useTagFilterStore.getState()
      clearFilters()

      const { selectedTags, tagMatch } = useTagFilterStore.getState()
      expect(selectedTags).toEqual([])
      expect(tagMatch).toBe('all')
    })
  })
})
