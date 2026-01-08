/**
 * Tests for useTagAutocomplete hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTagAutocomplete } from './useTagAutocomplete'
import type { TagCount } from '../types'

describe('useTagAutocomplete', () => {
  const mockSuggestions: TagCount[] = [
    { name: 'react', count: 5 },
    { name: 'typescript', count: 3 },
    { name: 'javascript', count: 7 },
    { name: 'testing', count: 2 },
  ]

  let mockOnChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnChange = vi.fn()
  })

  describe('initial state', () => {
    it('should initialize with empty input value', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      expect(result.current.inputValue).toBe('')
    })

    it('should initialize with suggestions hidden', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      expect(result.current.showSuggestions).toBe(false)
    })

    it('should initialize with no highlighted index', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      expect(result.current.highlightedIndex).toBe(-1)
    })

    it('should initialize with no error', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      expect(result.current.error).toBeNull()
    })
  })

  describe('filtering suggestions', () => {
    it('should filter suggestions based on input value', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.setInputValue('type')
      })

      expect(result.current.filteredSuggestions).toHaveLength(1)
      expect(result.current.filteredSuggestions[0].name).toBe('typescript')
    })

    it('should filter case-insensitively', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.setInputValue('REACT')
      })

      expect(result.current.filteredSuggestions).toHaveLength(1)
      expect(result.current.filteredSuggestions[0].name).toBe('react')
    })

    it('should exclude already selected tags from suggestions', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: ['react'],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      expect(result.current.filteredSuggestions.find((s) => s.name === 'react')).toBeUndefined()
    })

    it('should show all non-selected suggestions when input is empty', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: ['react'],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      expect(result.current.filteredSuggestions).toHaveLength(3)
    })
  })

  describe('addTag', () => {
    it('should add a valid tag', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        const success = result.current.addTag('new-tag')
        expect(success).toBe(true)
      })

      expect(mockOnChange).toHaveBeenCalledWith(['new-tag'])
    })

    it('should normalize tag to lowercase', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.addTag('NEW-TAG')
      })

      expect(mockOnChange).toHaveBeenCalledWith(['new-tag'])
    })

    it('should trim whitespace from tag', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.addTag('  spaced-tag  ')
      })

      expect(mockOnChange).toHaveBeenCalledWith(['spaced-tag'])
    })

    it('should reject empty tag', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        const success = result.current.addTag('')
        expect(success).toBe(false)
      })

      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should reject duplicate tag with error message', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: ['existing'],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        const success = result.current.addTag('existing')
        expect(success).toBe(false)
      })

      expect(result.current.error).toBe('Tag already added')
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should reject invalid tag format with error message', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        const success = result.current.addTag('invalid tag!')
        expect(success).toBe(false)
      })

      expect(result.current.error).toBe('Tags must be lowercase letters, numbers, and hyphens only')
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should clear input value after successful add', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.setInputValue('test')
      })

      expect(result.current.inputValue).toBe('test')

      act(() => {
        result.current.addTag('new-tag')
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should close suggestions after successful add', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.openSuggestions()
      })

      expect(result.current.showSuggestions).toBe(true)

      act(() => {
        result.current.addTag('new-tag')
      })

      expect(result.current.showSuggestions).toBe(false)
    })
  })

  describe('removeTag', () => {
    it('should remove a tag', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: ['tag1', 'tag2', 'tag3'],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.removeTag('tag2')
      })

      expect(mockOnChange).toHaveBeenCalledWith(['tag1', 'tag3'])
    })

    it('should not call onChange for non-existent tag', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: ['tag1'],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.removeTag('nonexistent')
      })

      // Should NOT call onChange when tag doesn't exist (avoids unnecessary re-renders)
      expect(mockOnChange).not.toHaveBeenCalled()
    })
  })

  describe('highlight navigation', () => {
    it('should move highlight down', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.openSuggestions()
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(0)

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(1)
    })

    it('should move highlight up', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      // Need separate act blocks to allow state updates between calls
      act(() => {
        result.current.openSuggestions()
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(1)

      act(() => {
        result.current.moveHighlight('up')
      })

      expect(result.current.highlightedIndex).toBe(0)
    })

    it('should not go below 0', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      // Need separate act blocks to allow state updates between calls
      act(() => {
        result.current.openSuggestions()
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(0)

      act(() => {
        result.current.moveHighlight('up')
      })

      expect(result.current.highlightedIndex).toBe(0)
    })

    it('should not exceed max index', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.openSuggestions()
      })

      // Move past the end
      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.moveHighlight('down')
        })
      }

      expect(result.current.highlightedIndex).toBe(mockSuggestions.length - 1)
    })

    it('should not move when suggestions are hidden', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(-1)
    })
  })

  describe('selectHighlighted', () => {
    it('should add the highlighted suggestion', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      // Need separate act blocks to allow state updates between calls
      act(() => {
        result.current.openSuggestions()
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      act(() => {
        const success = result.current.selectHighlighted()
        expect(success).toBe(true)
      })

      expect(mockOnChange).toHaveBeenCalledWith(['react'])
    })

    it('should return false when nothing is highlighted', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        const success = result.current.selectHighlighted()
        expect(success).toBe(false)
      })

      expect(mockOnChange).not.toHaveBeenCalled()
    })
  })

  describe('openSuggestions and closeSuggestions', () => {
    it('should open suggestions', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.openSuggestions()
      })

      expect(result.current.showSuggestions).toBe(true)
    })

    it('should close suggestions and reset highlight', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      // Need separate act blocks to allow state updates between calls
      act(() => {
        result.current.openSuggestions()
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(1)

      act(() => {
        result.current.closeSuggestions()
      })

      expect(result.current.showSuggestions).toBe(false)
      expect(result.current.highlightedIndex).toBe(-1)
    })
  })

  describe('getPendingValue and clearPending', () => {
    it('should return current input value trimmed', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.setInputValue('  pending  ')
      })

      expect(result.current.getPendingValue()).toBe('pending')
    })

    it('should clear pending input', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.setInputValue('pending')
      })

      expect(result.current.inputValue).toBe('pending')

      act(() => {
        result.current.clearPending()
      })

      expect(result.current.inputValue).toBe('')
    })

    it('should clear error when clearing pending', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.addTag('invalid!')
      })

      expect(result.current.error).not.toBeNull()

      act(() => {
        result.current.clearPending()
      })

      expect(result.current.error).toBeNull()
    })
  })

  describe('clearError', () => {
    it('should clear the error', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: ['existing'],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.addTag('existing')
      })

      expect(result.current.error).toBe('Tag already added')

      act(() => {
        result.current.clearError()
      })

      expect(result.current.error).toBeNull()
    })
  })

  describe('setInputValue', () => {
    it('should clear error when input changes', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      act(() => {
        result.current.addTag('invalid!')
      })

      expect(result.current.error).not.toBeNull()

      act(() => {
        result.current.setInputValue('new-input')
      })

      expect(result.current.error).toBeNull()
    })

    it('should reset highlighted index when input changes', () => {
      const { result } = renderHook(() =>
        useTagAutocomplete({
          value: [],
          onChange: mockOnChange,
          suggestions: mockSuggestions,
        })
      )

      // Need separate act blocks to allow state updates between calls
      act(() => {
        result.current.openSuggestions()
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      act(() => {
        result.current.moveHighlight('down')
      })

      expect(result.current.highlightedIndex).toBe(1)

      act(() => {
        result.current.setInputValue('new')
      })

      expect(result.current.highlightedIndex).toBe(-1)
    })
  })
})
