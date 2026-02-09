/**
 * Tests for InlineEditableTags component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineEditableTags } from './InlineEditableTags'
import type { InlineEditableTagsHandle } from './InlineEditableTags'
import type { TagCount } from '../types'
import { createRef } from 'react'

describe('InlineEditableTags', () => {
  const mockSuggestions: TagCount[] = [
    { name: 'react', content_count: 5, filter_count: 0 },
    { name: 'typescript', content_count: 3, filter_count: 0 },
    { name: 'javascript', content_count: 7, filter_count: 0 },
  ]

  let mockOnChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnChange = vi.fn()
  })

  describe('rendering tags', () => {
    it('should render existing tags as pills', () => {
      render(
        <InlineEditableTags
          value={['tag1', 'tag2']}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      expect(screen.getByText('tag1')).toBeInTheDocument()
      expect(screen.getByText('tag2')).toBeInTheDocument()
    })

    it('should render add button when not disabled', () => {
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
    })

    it('should disable add button when disabled (but keep it visible to prevent layout shift)', () => {
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
          disabled
        />
      )

      const addButton = screen.getByRole('button', { name: 'Add tag' })
      expect(addButton).toBeInTheDocument()
      expect(addButton).toBeDisabled()
    })
  })

  describe('removing tags', () => {
    it('should call onChange when remove button is clicked', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={['tag1', 'tag2']}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      const removeButton = screen.getByRole('button', { name: 'Remove tag tag1' })
      await user.click(removeButton)

      expect(mockOnChange).toHaveBeenCalledWith(['tag2'])
    })

    it('should not show remove button when disabled', () => {
      render(
        <InlineEditableTags
          value={['tag1']}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
          disabled
        />
      )

      expect(screen.queryByRole('button', { name: 'Remove tag tag1' })).not.toBeInTheDocument()
    })
  })

  describe('adding tags', () => {
    it('should show input when add button is clicked', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument()
    })

    it('should add tag on Enter', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'new-tag{Enter}')

      expect(mockOnChange).toHaveBeenCalledWith(['new-tag'])
    })

    it('should add tag on comma', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'new-tag,')

      expect(mockOnChange).toHaveBeenCalledWith(['new-tag'])
    })

    it('should show error for invalid tag', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'invalid tag!{Enter}')

      expect(screen.getByText('Tags must be lowercase letters, numbers, and hyphens only')).toBeInTheDocument()
      expect(mockOnChange).not.toHaveBeenCalled()
    })

    it('should close input on Escape', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByPlaceholderText('Add tag...')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
    })
  })

  describe('suggestions dropdown', () => {
    it('should show suggestions when input is focused', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      // Wait for suggestions to appear
      expect(screen.getByText('react')).toBeInTheDocument()
      expect(screen.getByText('typescript')).toBeInTheDocument()
      expect(screen.getByText('javascript')).toBeInTheDocument()
    })

    it('should filter suggestions based on input', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'type')

      expect(screen.getByText('typescript')).toBeInTheDocument()
      expect(screen.queryByText('react')).not.toBeInTheDocument()
      expect(screen.queryByText('javascript')).not.toBeInTheDocument()
    })

    it('should add tag when suggestion is clicked', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.click(screen.getByText('react'))

      expect(mockOnChange).toHaveBeenCalledWith(['react'])
    })

    it('should exclude already selected tags from suggestions', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={['react']}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      // 'react' is already selected, should not be in suggestions
      // There are two 'react' texts - one is the tag pill, one would be suggestion
      const reactElements = screen.getAllByText('react')
      expect(reactElements).toHaveLength(1) // Only the tag pill
    })
  })

  describe('keyboard navigation', () => {
    it('should navigate suggestions with arrow keys', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      // Arrow down to highlight first suggestion
      await user.keyboard('{ArrowDown}')

      const reactButton = screen.getByRole('button', { name: /react/ })
      expect(reactButton).toHaveAttribute('aria-selected', 'true')
    })

    it('should select highlighted suggestion on Enter', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.keyboard('{ArrowDown}{Enter}')

      expect(mockOnChange).toHaveBeenCalledWith(['react'])
    })

    it('should remove last tag on Backspace when input is empty', async () => {
      const user = userEvent.setup()
      render(
        <InlineEditableTags
          value={['tag1', 'tag2']}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.keyboard('{Backspace}')

      expect(mockOnChange).toHaveBeenCalledWith(['tag1'])
    })
  })

  describe('ref handle', () => {
    it('should expose getPendingValue via ref', async () => {
      const user = userEvent.setup()
      const ref = createRef<InlineEditableTagsHandle>()

      render(
        <InlineEditableTags
          ref={ref}
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'pending')

      expect(ref.current?.getPendingValue()).toBe('pending')
    })

    it('should expose clearPending via ref', async () => {
      const user = userEvent.setup()
      const ref = createRef<InlineEditableTagsHandle>()

      render(
        <InlineEditableTags
          ref={ref}
          value={[]}
          onChange={mockOnChange}
          suggestions={mockSuggestions}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'pending')

      expect(ref.current?.getPendingValue()).toBe('pending')

      // Need to wrap state changes in act to flush updates
      await act(async () => {
        ref.current?.clearPending()
      })

      expect(ref.current?.getPendingValue()).toBe('')
    })
  })

  describe('click outside behavior', () => {
    it('should close suggestions when clicking outside', async () => {
      const user = userEvent.setup()
      render(
        <div>
          <InlineEditableTags
            value={[]}
            onChange={mockOnChange}
            suggestions={mockSuggestions}
          />
          <button>Outside</button>
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      expect(screen.getByText('react')).toBeInTheDocument()

      await user.click(screen.getByText('Outside'))

      // Suggestions should be hidden
      expect(screen.queryByText('react')).not.toBeInTheDocument()
    })
  })
})
