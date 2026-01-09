/**
 * Tests for editor utility functions.
 */
import { describe, it, expect } from 'vitest'
import { shouldHandleEmptySpaceClick } from './editorUtils'

describe('shouldHandleEmptySpaceClick', () => {
  // Helper to create a mock element with specified classes and parent structure
  const createMockElement = (
    classes: string[] = [],
    closestProseMirror: boolean = false,
    isSameAsClosest: boolean = false
  ): HTMLElement => {
    const element = document.createElement('div')
    classes.forEach((cls) => element.classList.add(cls))

    // Mock closest to return null or a prosemirror element
    element.closest = (selector: string): Element | null => {
      if (selector === '.ProseMirror') {
        if (closestProseMirror) {
          return isSameAsClosest ? element : document.createElement('div')
        }
        return null
      }
      return null
    }

    return element
  }

  describe('when there is an existing selection (selectionEmpty = false)', () => {
    it('should return false to preserve drag selection', () => {
      const target = createMockElement()
      expect(shouldHandleEmptySpaceClick(false, target)).toBe(false)
    })

    it('should return false even for milkdown-wrapper clicks', () => {
      const target = createMockElement(['milkdown-wrapper'])
      expect(shouldHandleEmptySpaceClick(false, target)).toBe(false)
    })

    it('should return false even for editor class clicks', () => {
      const target = createMockElement(['editor'])
      expect(shouldHandleEmptySpaceClick(false, target)).toBe(false)
    })
  })

  describe('when selection is empty (selectionEmpty = true)', () => {
    it('should return true when clicking on element with milkdown-wrapper class', () => {
      const target = createMockElement(['milkdown-wrapper'])
      expect(shouldHandleEmptySpaceClick(true, target)).toBe(true)
    })

    it('should return true when clicking on element with milkdown class', () => {
      const target = createMockElement(['milkdown'])
      expect(shouldHandleEmptySpaceClick(true, target)).toBe(true)
    })

    it('should return true when clicking on element with editor class', () => {
      const target = createMockElement(['editor'])
      expect(shouldHandleEmptySpaceClick(true, target)).toBe(true)
    })

    it('should return true when no ProseMirror element is found', () => {
      const target = createMockElement([], false)
      expect(shouldHandleEmptySpaceClick(true, target)).toBe(true)
    })

    it('should return true when target is the ProseMirror element itself', () => {
      const target = createMockElement([], true, true)
      expect(shouldHandleEmptySpaceClick(true, target)).toBe(true)
    })

    it('should return false when clicking inside ProseMirror content', () => {
      // Target is a child of ProseMirror but not the ProseMirror element itself
      const target = createMockElement([], true, false)
      expect(shouldHandleEmptySpaceClick(true, target)).toBe(false)
    })
  })
})
