/**
 * Tests for AddTagButton component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddTagButton } from './AddTagButton'
import type { TagCount } from '../types'

describe('AddTagButton', () => {
  const mockSuggestions: TagCount[] = [
    { name: 'react', content_count: 5, filter_count: 0 },
    { name: 'typescript', content_count: 3, filter_count: 0 },
    { name: 'javascript', content_count: 7, filter_count: 0 },
  ]

  let mockOnAdd: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnAdd = vi.fn()
  })

  describe('rendering', () => {
    it('renders + button', () => {
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
    })

    it('click opens dropdown with input', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument()
    })
  })

  describe('suggestions', () => {
    it('shows suggestions when dropdown opens', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      expect(screen.getByText('react')).toBeInTheDocument()
      expect(screen.getByText('typescript')).toBeInTheDocument()
      expect(screen.getByText('javascript')).toBeInTheDocument()
    })

    it('excludes existing tags from suggestions', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={['react']}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      // 'react' should not appear in suggestions
      expect(screen.queryByText('react')).not.toBeInTheDocument()
      expect(screen.getByText('typescript')).toBeInTheDocument()
      expect(screen.getByText('javascript')).toBeInTheDocument()
    })

    it('typing filters suggestions', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'type')

      expect(screen.getByText('typescript')).toBeInTheDocument()
      expect(screen.queryByText('react')).not.toBeInTheDocument()
      expect(screen.queryByText('javascript')).not.toBeInTheDocument()
    })

    it('clicking a suggestion calls onAdd and closes dropdown', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.click(screen.getByText('react'))

      expect(mockOnAdd).toHaveBeenCalledWith('react')
      // Dropdown should close - input should be gone
      expect(screen.queryByPlaceholderText('Add tag...')).not.toBeInTheDocument()
    })
  })

  describe('adding new tags', () => {
    it('Enter key on typed text calls onAdd with normalized tag', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'new-tag{Enter}')

      expect(mockOnAdd).toHaveBeenCalledWith('new-tag')
    })

    it('does not call onAdd for empty input', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.keyboard('{Enter}')

      expect(mockOnAdd).not.toHaveBeenCalled()
    })

    it('does not call onAdd for duplicate tag', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={['existing']}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'existing{Enter}')

      expect(mockOnAdd).not.toHaveBeenCalled()
      // Should show error
      expect(screen.getByText('Tag already added')).toBeInTheDocument()
    })

    it('shows inline validation error for invalid tag characters', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.type(screen.getByPlaceholderText('Add tag...'), 'invalid tag!{Enter}')

      expect(mockOnAdd).not.toHaveBeenCalled()
      expect(screen.getByText('Tags must be lowercase letters, numbers, and hyphens only')).toBeInTheDocument()
    })
  })

  describe('keyboard navigation', () => {
    it('ArrowDown/ArrowUp navigates suggestions', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      // Arrow down to highlight first suggestion
      await user.keyboard('{ArrowDown}')

      const reactButton = screen.getByRole('button', { name: /react/ })
      expect(reactButton).toHaveAttribute('aria-selected', 'true')

      // Arrow down again to highlight second
      await user.keyboard('{ArrowDown}')

      const typescriptButton = screen.getByRole('button', { name: /typescript/ })
      expect(typescriptButton).toHaveAttribute('aria-selected', 'true')
      expect(reactButton).toHaveAttribute('aria-selected', 'false')

      // Arrow up to go back
      await user.keyboard('{ArrowUp}')
      expect(reactButton).toHaveAttribute('aria-selected', 'true')
    })

    it('Enter selects highlighted suggestion', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.keyboard('{ArrowDown}{Enter}')

      expect(mockOnAdd).toHaveBeenCalledWith('react')
    })

    it('Escape closes dropdown without adding', async () => {
      const user = userEvent.setup()
      render(
        <AddTagButton
          existingTags={[]}
          suggestions={mockSuggestions}
          onAdd={mockOnAdd}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(mockOnAdd).not.toHaveBeenCalled()
      expect(screen.queryByPlaceholderText('Add tag...')).not.toBeInTheDocument()
      // Button should be back
      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
    })
  })

  describe('click outside behavior', () => {
    it('closes dropdown when clicking outside', async () => {
      const user = userEvent.setup()
      render(
        <div>
          <AddTagButton
            existingTags={[]}
            suggestions={mockSuggestions}
            onAdd={mockOnAdd}
          />
          <button>Outside</button>
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      expect(screen.getByPlaceholderText('Add tag...')).toBeInTheDocument()

      await user.click(screen.getByText('Outside'))

      expect(screen.queryByPlaceholderText('Add tag...')).not.toBeInTheDocument()
      expect(mockOnAdd).not.toHaveBeenCalled()
    })
  })

  describe('event propagation', () => {
    it('stops propagation on button click', async () => {
      const user = userEvent.setup()
      const cardClick = vi.fn()

      render(
        <div onClick={cardClick}>
          <AddTagButton
            existingTags={[]}
            suggestions={mockSuggestions}
            onAdd={mockOnAdd}
          />
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))

      expect(cardClick).not.toHaveBeenCalled()
    })

    it('stops propagation on suggestion click', async () => {
      const user = userEvent.setup()
      const cardClick = vi.fn()

      render(
        <div onClick={cardClick}>
          <AddTagButton
            existingTags={[]}
            suggestions={mockSuggestions}
            onAdd={mockOnAdd}
          />
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Add tag' }))
      await user.click(screen.getByText('react'))

      expect(cardClick).not.toHaveBeenCalled()
    })
  })
})
