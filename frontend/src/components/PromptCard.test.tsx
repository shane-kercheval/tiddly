/**
 * Tests for PromptCard component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptCard } from './PromptCard'
import type { PromptListItem } from '../types'

const mockPrompt: PromptListItem = {
  id: 1,
  name: 'code-review',
  title: 'Code Review Prompt',
  description: 'A prompt for reviewing code',
  arguments: [
    { name: 'code', description: 'Code to review', required: true },
    { name: 'language', description: null, required: false },
  ],
  tags: ['code', 'review'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_used_at: '2024-01-03T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

describe('PromptCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render prompt title', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      expect(screen.getByText('Code Review Prompt')).toBeInTheDocument()
    })

    it('should render name when no title', () => {
      const promptWithoutTitle = { ...mockPrompt, title: null }
      render(<PromptCard prompt={promptWithoutTitle} onDelete={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'code-review' })).toBeInTheDocument()
    })

    it('should show name in parentheses when title differs', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      expect(screen.getByText('code-review')).toBeInTheDocument()
    })

    it('should render description', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      // Description appears in both mobile and desktop views
      const descriptions = screen.getAllByText('A prompt for reviewing code')
      expect(descriptions.length).toBeGreaterThan(0)
    })

    it('should render tags', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      expect(screen.getByText('code')).toBeInTheDocument()
      expect(screen.getByText('review')).toBeInTheDocument()
    })

    it('should render created date by default', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      expect(screen.getByText(/Created:/)).toBeInTheDocument()
    })
  })

  describe('date display', () => {
    it('should show modified date when sortBy is updated_at', () => {
      render(<PromptCard prompt={mockPrompt} sortBy="updated_at" onDelete={vi.fn()} />)

      expect(screen.getByText(/Modified:/)).toBeInTheDocument()
    })

    it('should show used date when sortBy is last_used_at', () => {
      render(<PromptCard prompt={mockPrompt} sortBy="last_used_at" onDelete={vi.fn()} />)

      expect(screen.getByText(/Used:/)).toBeInTheDocument()
    })

    it('should show created date for title sort', () => {
      render(<PromptCard prompt={mockPrompt} sortBy="title" onDelete={vi.fn()} />)

      expect(screen.getByText(/Created:/)).toBeInTheDocument()
    })
  })

  describe('title click', () => {
    it('should call onView when title is clicked', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} onView={onView} />)

      await user.click(screen.getByRole('button', { name: 'Code Review Prompt' }))

      expect(onView).toHaveBeenCalledWith(mockPrompt)
    })
  })

  describe('tag clicks', () => {
    it('should call onTagClick when a tag is clicked', async () => {
      const onTagClick = vi.fn()
      const user = userEvent.setup()

      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} onTagClick={onTagClick} />)

      await user.click(screen.getByRole('button', { name: 'code' }))

      expect(onTagClick).toHaveBeenCalledWith('code')
    })
  })

  describe('action buttons - active view', () => {
    it('should show archive button in active view', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          view="active"
          onDelete={vi.fn()}
          onArchive={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /archive prompt/i })).toBeInTheDocument()
    })

    it('should show delete button in active view', () => {
      render(<PromptCard prompt={mockPrompt} view="active" onDelete={vi.fn()} />)

      expect(screen.getByRole('button', { name: /delete prompt/i })).toBeInTheDocument()
    })

    it('should call onArchive when archive button is clicked', async () => {
      const onArchive = vi.fn()
      const user = userEvent.setup()

      render(
        <PromptCard
          prompt={mockPrompt}
          view="active"
          onDelete={vi.fn()}
          onArchive={onArchive}
        />
      )

      await user.click(screen.getByRole('button', { name: /archive prompt/i }))

      expect(onArchive).toHaveBeenCalledWith(mockPrompt)
    })

    it('should call onDelete when delete button is clicked', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()

      render(<PromptCard prompt={mockPrompt} view="active" onDelete={onDelete} />)

      await user.click(screen.getByRole('button', { name: /delete prompt/i }))

      expect(onDelete).toHaveBeenCalledWith(mockPrompt)
    })
  })

  describe('action buttons - archived view', () => {
    it('should show restore button in archived view', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          view="archived"
          onDelete={vi.fn()}
          onUnarchive={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /restore prompt/i })).toBeInTheDocument()
    })

    it('should not show archive button in archived view', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          view="archived"
          onDelete={vi.fn()}
          onArchive={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: /archive prompt/i })).not.toBeInTheDocument()
    })

    it('should call onUnarchive when restore button is clicked', async () => {
      const onUnarchive = vi.fn()
      const user = userEvent.setup()

      render(
        <PromptCard
          prompt={mockPrompt}
          view="archived"
          onDelete={vi.fn()}
          onUnarchive={onUnarchive}
        />
      )

      await user.click(screen.getByRole('button', { name: /restore prompt/i }))

      expect(onUnarchive).toHaveBeenCalledWith(mockPrompt)
    })
  })

  describe('action buttons - deleted view', () => {
    it('should show restore button in deleted view', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          view="deleted"
          onDelete={vi.fn()}
          onRestore={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /restore prompt/i })).toBeInTheDocument()
    })

    it('should not make card clickable in deleted view', () => {
      const { container } = render(
        <PromptCard
          prompt={mockPrompt}
          view="deleted"
          onDelete={vi.fn()}
          onEdit={vi.fn()}
        />
      )

      // Card should not have cursor-pointer class in deleted view
      const card = container.querySelector('.card')
      expect(card).not.toHaveClass('cursor-pointer')
    })

    it('should show confirm delete button in deleted view', () => {
      render(<PromptCard prompt={mockPrompt} view="deleted" onDelete={vi.fn()} />)

      // ConfirmDeleteButton initially shows "Delete permanently" tooltip
      expect(screen.getByTitle('Delete permanently')).toBeInTheDocument()
    })

    it('should call onRestore when restore button is clicked', async () => {
      const onRestore = vi.fn()
      const user = userEvent.setup()

      render(
        <PromptCard
          prompt={mockPrompt}
          view="deleted"
          onDelete={vi.fn()}
          onRestore={onRestore}
        />
      )

      await user.click(screen.getByRole('button', { name: /restore prompt/i }))

      expect(onRestore).toHaveBeenCalledWith(mockPrompt)
    })
  })

  describe('tag removal', () => {
    it('should call onTagRemove when tag remove button is clicked', async () => {
      const onTagRemove = vi.fn()
      const user = userEvent.setup()

      render(
        <PromptCard
          prompt={mockPrompt}
          onDelete={vi.fn()}
          onTagRemove={onTagRemove}
        />
      )

      // Hover to reveal remove button, then click
      const removeButton = screen.getByRole('button', { name: /remove tag code/i })
      await user.click(removeButton)

      expect(onTagRemove).toHaveBeenCalledWith(mockPrompt, 'code')
    })
  })

  describe('loading state', () => {
    it('should show spinner in hover indicator when isLoading', () => {
      const { container } = render(
        <PromptCard
          prompt={mockPrompt}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          isLoading={true}
        />
      )

      // Spinner should be visible in the hover edit indicator
      expect(container.querySelector('.spinner-sm')).toBeInTheDocument()
    })
  })

  describe('card click to view', () => {
    it('should call onView when card is clicked in active view', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <PromptCard
          prompt={mockPrompt}
          view="active"
          onDelete={vi.fn()}
          onView={onView}
        />
      )

      // Click the card directly
      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onView).toHaveBeenCalledWith(mockPrompt)
    })

    it('should call onView when card is clicked in archived view', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <PromptCard
          prompt={mockPrompt}
          view="archived"
          onDelete={vi.fn()}
          onView={onView}
        />
      )

      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onView).toHaveBeenCalledWith(mockPrompt)
    })

    it('should not call onEdit when card is clicked (edit only via button)', async () => {
      const onEdit = vi.fn()
      const onView = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <PromptCard
          prompt={mockPrompt}
          view="active"
          onDelete={vi.fn()}
          onEdit={onEdit}
          onView={onView}
        />
      )

      // Click the card
      const card = container.querySelector('.card')
      await user.click(card!)

      // onView should be called, not onEdit
      expect(onView).toHaveBeenCalledWith(mockPrompt)
      expect(onEdit).not.toHaveBeenCalled()
    })
  })
})
