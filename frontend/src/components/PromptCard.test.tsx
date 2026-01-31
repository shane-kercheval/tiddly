/**
 * Tests for PromptCard component.
 *
 * Note: PromptCard renders both mobile and desktop layouts (hidden via CSS).
 * Tests use getAllByRole and take the first match for elements that appear twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptCard } from './PromptCard'
import type { PromptListItem } from '../types'

const mockPrompt: PromptListItem = {
  id: '1',
  name: 'code-review',
  title: 'Code Review Prompt',
  description: 'A prompt for reviewing code',
  arguments: [
    { name: 'code', description: 'Code to review', required: true },
    { name: 'language', description: null, required: false },
  ],
  tags: ['code', 'review'],
  // Use noon UTC to avoid timezone edge cases
  created_at: '2024-01-01T12:00:00Z',
  updated_at: '2024-01-02T12:00:00Z',
  last_used_at: '2024-01-03T12:00:00Z',
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

      // Title appears in both mobile and desktop layouts
      const titles = screen.getAllByText('Code Review Prompt')
      expect(titles.length).toBeGreaterThan(0)
    })

    it('should render name when no title', () => {
      const promptWithoutTitle = { ...mockPrompt, title: null }
      render(<PromptCard prompt={promptWithoutTitle} onDelete={vi.fn()} />)

      // Name appears in both layouts
      const buttons = screen.getAllByRole('button', { name: 'code-review' })
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should show name in parentheses when title differs', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      // Name appears in both mobile and desktop views
      const names = screen.getAllByText('code-review')
      expect(names.length).toBeGreaterThan(0)
    })

    it('should render description', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      // Description appears in both mobile and desktop views
      const descriptions = screen.getAllByText('A prompt for reviewing code')
      expect(descriptions.length).toBeGreaterThan(0)
    })

    it('should render tags', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      // Tags appear in both layouts
      const codeTags = screen.getAllByText('code')
      const reviewTags = screen.getAllByText('review')
      expect(codeTags.length).toBeGreaterThan(0)
      expect(reviewTags.length).toBeGreaterThan(0)
    })

    it('should render created date by default', () => {
      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} />)

      // Date is shown, label is in tooltip (not visible text)
      const dates = screen.getAllByText('Jan 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })
  })

  describe('date display', () => {
    it('should show updated date when sortBy is updated_at', () => {
      render(<PromptCard prompt={mockPrompt} sortBy="updated_at" onDelete={vi.fn()} />)

      // Shows date, label in tooltip
      const dates = screen.getAllByText('Jan 2, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show last used date when sortBy is last_used_at', () => {
      render(<PromptCard prompt={mockPrompt} sortBy="last_used_at" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Jan 3, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show created date for title sort', () => {
      render(<PromptCard prompt={mockPrompt} sortBy="title" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Jan 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show archived date when sortBy is archived_at', () => {
      const archivedPrompt = { ...mockPrompt, archived_at: '2024-02-01T12:00:00Z' }
      render(<PromptCard prompt={archivedPrompt} sortBy="archived_at" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Feb 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show deleted date when sortBy is deleted_at', () => {
      const deletedPrompt = { ...mockPrompt, deleted_at: '2024-03-01T12:00:00Z' }
      render(<PromptCard prompt={deletedPrompt} sortBy="deleted_at" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Mar 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })
  })

  describe('title click', () => {
    it('should call onView when title is clicked', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} onView={onView} />)

      const buttons = screen.getAllByRole('button', { name: 'Code Review Prompt' })
      await user.click(buttons[0])

      expect(onView).toHaveBeenCalledWith(mockPrompt)
    })
  })

  describe('tag clicks', () => {
    it('should call onTagClick when a tag is clicked', async () => {
      const onTagClick = vi.fn()
      const user = userEvent.setup()

      render(<PromptCard prompt={mockPrompt} onDelete={vi.fn()} onTagClick={onTagClick} />)

      const tagButtons = screen.getAllByRole('button', { name: 'code' })
      await user.click(tagButtons[0])

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

      const archiveButtons = screen.getAllByRole('button', { name: /archive prompt/i })
      expect(archiveButtons.length).toBeGreaterThan(0)
    })

    it('should show delete button in active view', () => {
      render(<PromptCard prompt={mockPrompt} view="active" onDelete={vi.fn()} />)

      const deleteButtons = screen.getAllByRole('button', { name: /delete prompt/i })
      expect(deleteButtons.length).toBeGreaterThan(0)
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

      const archiveButtons = screen.getAllByRole('button', { name: /archive prompt/i })
      await user.click(archiveButtons[0])

      expect(onArchive).toHaveBeenCalledWith(mockPrompt)
    })

    it('should call onDelete when delete button is clicked', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()

      render(<PromptCard prompt={mockPrompt} view="active" onDelete={onDelete} />)

      const deleteButtons = screen.getAllByRole('button', { name: /delete prompt/i })
      await user.click(deleteButtons[0])

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

      const restoreButtons = screen.getAllByRole('button', { name: /restore prompt/i })
      expect(restoreButtons.length).toBeGreaterThan(0)
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

      const restoreButtons = screen.getAllByRole('button', { name: /restore prompt/i })
      await user.click(restoreButtons[0])

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

      const restoreButtons = screen.getAllByRole('button', { name: /restore prompt/i })
      expect(restoreButtons.length).toBeGreaterThan(0)
    })

    it('should not make card clickable in deleted view', () => {
      const { container } = render(
        <PromptCard
          prompt={mockPrompt}
          view="deleted"
          onDelete={vi.fn()}
        />
      )

      // Card should not have cursor-pointer class in deleted view
      const card = container.querySelector('.card')
      expect(card).not.toHaveClass('cursor-pointer')
    })

    it('should show confirm delete button in deleted view', () => {
      render(<PromptCard prompt={mockPrompt} view="deleted" onDelete={vi.fn()} />)

      // ConfirmDeleteButton initially shows "Delete permanently" aria-label
      const deleteButtons = screen.getAllByRole('button', { name: 'Delete permanently' })
      expect(deleteButtons.length).toBeGreaterThan(0)
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

      const restoreButtons = screen.getAllByRole('button', { name: /restore prompt/i })
      await user.click(restoreButtons[0])

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

      // Multiple remove buttons exist (mobile + desktop)
      const removeButtons = screen.getAllByRole('button', { name: /remove tag code/i })
      await user.click(removeButtons[0])

      expect(onTagRemove).toHaveBeenCalledWith(mockPrompt, 'code')
    })
  })

  describe('tag addition', () => {
    const mockSuggestions = [
      { name: 'react', content_count: 5, filter_count: 0 },
      { name: 'typescript', content_count: 3, filter_count: 0 },
    ]

    it('should show add tag button when onTagAdd is provided', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const addButtons = screen.getAllByRole('button', { name: 'Add tag' })
      expect(addButtons.length).toBeGreaterThan(0)
    })

    it('should not show add tag button when onTagAdd is not provided', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          onDelete={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })

    it('should show add tag button even when item has zero tags', () => {
      const promptWithNoTags = { ...mockPrompt, tags: [] }

      render(
        <PromptCard
          prompt={promptWithNoTags}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const addButtons = screen.getAllByRole('button', { name: 'Add tag' })
      expect(addButtons.length).toBeGreaterThan(0)
    })

    it('should not show add tag button when tagSuggestions is not provided', () => {
      render(
        <PromptCard
          prompt={mockPrompt}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })
  })

  describe('copy button', () => {
    it('should show copy button in active view', () => {
      render(<PromptCard prompt={mockPrompt} view="active" onDelete={vi.fn()} />)

      const copyButtons = screen.getAllByRole('button', { name: /copy prompt content/i })
      expect(copyButtons.length).toBeGreaterThan(0)
    })

    it('should show copy button in archived view', () => {
      render(<PromptCard prompt={mockPrompt} view="archived" onDelete={vi.fn()} />)

      const copyButtons = screen.getAllByRole('button', { name: /copy prompt content/i })
      expect(copyButtons.length).toBeGreaterThan(0)
    })

    it('should not show copy button in deleted view', () => {
      render(<PromptCard prompt={mockPrompt} view="deleted" onDelete={vi.fn()} />)

      expect(screen.queryByRole('button', { name: /copy prompt content/i })).not.toBeInTheDocument()
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
  })
})
