/**
 * Tests for NoteCard component.
 *
 * Note: NoteCard renders both mobile and desktop layouts (hidden via CSS).
 * Tests use getAllByRole and take the first match for elements that appear twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteCard } from './NoteCard'
import type { NoteListItem } from '../types'

const mockNote: NoteListItem = {
  id: '1',
  title: 'Test Note',
  description: 'A test note description',
  tags: ['test', 'example'],
  // Use noon UTC to avoid timezone edge cases
  created_at: '2024-01-01T12:00:00Z',
  updated_at: '2024-01-02T12:00:00Z',
  last_used_at: '2024-01-03T12:00:00Z',
  deleted_at: null,
  archived_at: null,
  version: 1,
  content_preview: null,
}

describe('NoteCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render note title', () => {
      render(<NoteCard note={mockNote} onDelete={vi.fn()} />)

      // Title appears in both mobile and desktop layouts
      const titles = screen.getAllByText('Test Note')
      expect(titles.length).toBeGreaterThan(0)
    })

    it('should render note description', () => {
      render(<NoteCard note={mockNote} onDelete={vi.fn()} />)

      // Description appears in both mobile and desktop views
      const descriptions = screen.getAllByText('A test note description')
      expect(descriptions.length).toBeGreaterThan(0)
    })

    it('should render tags', () => {
      render(<NoteCard note={mockNote} onDelete={vi.fn()} />)

      // Tags appear in both layouts
      const testTags = screen.getAllByText('test')
      const exampleTags = screen.getAllByText('example')
      expect(testTags.length).toBeGreaterThan(0)
      expect(exampleTags.length).toBeGreaterThan(0)
    })

    it('should render created date by default', () => {
      render(<NoteCard note={mockNote} onDelete={vi.fn()} />)

      // Date is shown, label is in tooltip
      const dates = screen.getAllByText('Jan 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show version number when version > 1', () => {
      const noteWithVersion = { ...mockNote, version: 5 }
      render(<NoteCard note={noteWithVersion} onDelete={vi.fn()} />)

      // Version appears in both layouts
      const versions = screen.getAllByText('v5')
      expect(versions.length).toBeGreaterThan(0)
    })

    it('should not show version number when version is 1', () => {
      render(<NoteCard note={mockNote} onDelete={vi.fn()} />)

      expect(screen.queryByText('v1')).not.toBeInTheDocument()
    })

    it('should not render description section when empty', () => {
      const noteWithoutDesc = { ...mockNote, description: null }
      render(<NoteCard note={noteWithoutDesc} onDelete={vi.fn()} />)

      // Description paragraph should not exist
      expect(screen.queryByText('A test note description')).not.toBeInTheDocument()
    })

    it('should render content_preview when description is null', () => {
      const noteWithPreview = { ...mockNote, description: null, content_preview: 'Preview of note content' }
      render(<NoteCard note={noteWithPreview} onDelete={vi.fn()} />)

      // Preview appears in both mobile and desktop views
      const previews = screen.getAllByText('Preview of note content')
      expect(previews.length).toBeGreaterThan(0)
    })

    it('should prefer description over content_preview when both exist', () => {
      const noteWithBoth = { ...mockNote, description: 'The description', content_preview: 'The preview' }
      render(<NoteCard note={noteWithBoth} onDelete={vi.fn()} />)

      // Description should be shown
      const descriptions = screen.getAllByText('The description')
      expect(descriptions.length).toBeGreaterThan(0)
      // Preview should not be shown
      expect(screen.queryByText('The preview')).not.toBeInTheDocument()
    })

    it('should not render preview section when both description and content_preview are null', () => {
      const noteWithNeither = { ...mockNote, description: null, content_preview: null }
      render(<NoteCard note={noteWithNeither} onDelete={vi.fn()} />)

      // No preview text should be rendered (checking for non-breaking space used as placeholder)
      expect(screen.queryByText('A test note description')).not.toBeInTheDocument()
    })
  })

  describe('date display', () => {
    it('should show updated date when sortBy is updated_at', () => {
      render(<NoteCard note={mockNote} sortBy="updated_at" onDelete={vi.fn()} />)

      // Date is shown, label is in tooltip
      const dates = screen.getAllByText('Jan 2, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show last used date when sortBy is last_used_at', () => {
      render(<NoteCard note={mockNote} sortBy="last_used_at" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Jan 3, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show created date for title sort', () => {
      render(<NoteCard note={mockNote} sortBy="title" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Jan 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show archived date when sortBy is archived_at', () => {
      const archivedNote = { ...mockNote, archived_at: '2024-02-01T12:00:00Z' }
      render(<NoteCard note={archivedNote} sortBy="archived_at" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Feb 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })

    it('should show deleted date when sortBy is deleted_at', () => {
      const deletedNote = { ...mockNote, deleted_at: '2024-03-01T12:00:00Z' }
      render(<NoteCard note={deletedNote} sortBy="deleted_at" onDelete={vi.fn()} />)

      const dates = screen.getAllByText('Mar 1, 2024')
      expect(dates.length).toBeGreaterThan(0)
    })
  })

  describe('title click', () => {
    it('should call onView when title is clicked', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      render(<NoteCard note={mockNote} onDelete={vi.fn()} onView={onView} />)

      // Title button appears in both layouts
      const buttons = screen.getAllByRole('button', { name: 'Test Note' })
      await user.click(buttons[0])

      expect(onView).toHaveBeenCalledWith(mockNote)
    })
  })

  describe('tag clicks', () => {
    it('should call onTagClick when a tag is clicked', async () => {
      const onTagClick = vi.fn()
      const user = userEvent.setup()

      render(<NoteCard note={mockNote} onDelete={vi.fn()} onTagClick={onTagClick} />)

      const tagButtons = screen.getAllByRole('button', { name: 'test' })
      await user.click(tagButtons[0])

      expect(onTagClick).toHaveBeenCalledWith('test')
    })
  })

  describe('action buttons - active view', () => {
    it('should show archive button in active view', () => {
      render(
        <NoteCard
          note={mockNote}
          view="active"
          onDelete={vi.fn()}
          onArchive={vi.fn()}
        />
      )

      const archiveButtons = screen.getAllByRole('button', { name: /archive note/i })
      expect(archiveButtons.length).toBeGreaterThan(0)
    })

    it('should show delete button in active view', () => {
      render(<NoteCard note={mockNote} view="active" onDelete={vi.fn()} />)

      const deleteButtons = screen.getAllByRole('button', { name: /delete note/i })
      expect(deleteButtons.length).toBeGreaterThan(0)
    })

    it('should call onArchive when archive button is clicked', async () => {
      const onArchive = vi.fn()
      const user = userEvent.setup()

      render(
        <NoteCard
          note={mockNote}
          view="active"
          onDelete={vi.fn()}
          onArchive={onArchive}
        />
      )

      const archiveButtons = screen.getAllByRole('button', { name: /archive note/i })
      await user.click(archiveButtons[0])

      expect(onArchive).toHaveBeenCalledWith(mockNote)
    })

    it('should call onDelete when delete button is clicked', async () => {
      const onDelete = vi.fn()
      const user = userEvent.setup()

      render(<NoteCard note={mockNote} view="active" onDelete={onDelete} />)

      const deleteButtons = screen.getAllByRole('button', { name: /delete note/i })
      await user.click(deleteButtons[0])

      expect(onDelete).toHaveBeenCalledWith(mockNote)
    })
  })

  describe('action buttons - archived view', () => {
    it('should show restore button in archived view', () => {
      render(
        <NoteCard
          note={mockNote}
          view="archived"
          onDelete={vi.fn()}
          onUnarchive={vi.fn()}
        />
      )

      const restoreButtons = screen.getAllByRole('button', { name: /restore note/i })
      expect(restoreButtons.length).toBeGreaterThan(0)
    })

    it('should not show archive button in archived view', () => {
      render(
        <NoteCard
          note={mockNote}
          view="archived"
          onDelete={vi.fn()}
          onArchive={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: /archive note/i })).not.toBeInTheDocument()
    })

    it('should call onUnarchive when restore button is clicked', async () => {
      const onUnarchive = vi.fn()
      const user = userEvent.setup()

      render(
        <NoteCard
          note={mockNote}
          view="archived"
          onDelete={vi.fn()}
          onUnarchive={onUnarchive}
        />
      )

      const restoreButtons = screen.getAllByRole('button', { name: /restore note/i })
      await user.click(restoreButtons[0])

      expect(onUnarchive).toHaveBeenCalledWith(mockNote)
    })
  })

  describe('action buttons - deleted view', () => {
    it('should show restore button in deleted view', () => {
      render(
        <NoteCard
          note={mockNote}
          view="deleted"
          onDelete={vi.fn()}
          onRestore={vi.fn()}
        />
      )

      const restoreButtons = screen.getAllByRole('button', { name: /restore note/i })
      expect(restoreButtons.length).toBeGreaterThan(0)
    })

    it('should not make card clickable in deleted view', () => {
      const { container } = render(
        <NoteCard
          note={mockNote}
          view="deleted"
          onDelete={vi.fn()}
        />
      )

      // Card should not have cursor-pointer class in deleted view
      const card = container.querySelector('.card')
      expect(card).not.toHaveClass('cursor-pointer')
    })

    it('should show confirm delete button in deleted view', () => {
      render(<NoteCard note={mockNote} view="deleted" onDelete={vi.fn()} />)

      // ConfirmDeleteButton initially shows "Delete permanently" aria-label
      const deleteButtons = screen.getAllByRole('button', { name: 'Delete permanently' })
      expect(deleteButtons.length).toBeGreaterThan(0)
    })

    it('should call onRestore when restore button is clicked', async () => {
      const onRestore = vi.fn()
      const user = userEvent.setup()

      render(
        <NoteCard
          note={mockNote}
          view="deleted"
          onDelete={vi.fn()}
          onRestore={onRestore}
        />
      )

      const restoreButtons = screen.getAllByRole('button', { name: /restore note/i })
      await user.click(restoreButtons[0])

      expect(onRestore).toHaveBeenCalledWith(mockNote)
    })
  })

  describe('tag removal', () => {
    it('should call onTagRemove when tag remove button is clicked', async () => {
      const onTagRemove = vi.fn()
      const user = userEvent.setup()

      render(
        <NoteCard
          note={mockNote}
          onDelete={vi.fn()}
          onTagRemove={onTagRemove}
        />
      )

      // Multiple remove buttons exist (mobile + desktop)
      const removeButtons = screen.getAllByRole('button', { name: /remove tag test/i })
      await user.click(removeButtons[0])

      expect(onTagRemove).toHaveBeenCalledWith(mockNote, 'test')
    })
  })

  describe('tag addition', () => {
    const mockSuggestions = [
      { name: 'react', content_count: 5, filter_count: 0 },
      { name: 'typescript', content_count: 3, filter_count: 0 },
    ]

    it('should show add tag button when onTagAdd is provided', () => {
      render(
        <NoteCard
          note={mockNote}
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
        <NoteCard
          note={mockNote}
          onDelete={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })

    it('should show add tag button even when item has zero tags', () => {
      const noteWithNoTags = { ...mockNote, tags: [] }

      render(
        <NoteCard
          note={noteWithNoTags}
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
        <NoteCard
          note={mockNote}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })
  })

  describe('copy button', () => {
    it('should show copy button in active view', () => {
      render(<NoteCard note={mockNote} view="active" onDelete={vi.fn()} />)

      const copyButtons = screen.getAllByRole('button', { name: /copy note content/i })
      expect(copyButtons.length).toBeGreaterThan(0)
    })

    it('should show copy button in archived view', () => {
      render(<NoteCard note={mockNote} view="archived" onDelete={vi.fn()} />)

      const copyButtons = screen.getAllByRole('button', { name: /copy note content/i })
      expect(copyButtons.length).toBeGreaterThan(0)
    })

    it('should not show copy button in deleted view', () => {
      render(<NoteCard note={mockNote} view="deleted" onDelete={vi.fn()} />)

      expect(screen.queryByRole('button', { name: /copy note content/i })).not.toBeInTheDocument()
    })
  })

  describe('card click to view', () => {
    it('should call onView when card is clicked in active view', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <NoteCard
          note={mockNote}
          view="active"
          onDelete={vi.fn()}
          onView={onView}
        />
      )

      // Click the card directly
      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onView).toHaveBeenCalledWith(mockNote)
    })

    it('should call onView when card is clicked in archived view', async () => {
      const onView = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <NoteCard
          note={mockNote}
          view="archived"
          onDelete={vi.fn()}
          onView={onView}
        />
      )

      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onView).toHaveBeenCalledWith(mockNote)
    })

    it('should call onClick instead of onView when both are provided', async () => {
      const onClick = vi.fn()
      const onView = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <NoteCard
          note={mockNote}
          onDelete={vi.fn()}
          onClick={onClick}
          onView={onView}
        />
      )

      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onClick).toHaveBeenCalledWith(mockNote)
      expect(onView).not.toHaveBeenCalled()
    })

    it('should call onClick when provided without onView', async () => {
      const onClick = vi.fn()
      const user = userEvent.setup()

      const { container } = render(
        <NoteCard
          note={mockNote}
          onClick={onClick}
        />
      )

      const card = container.querySelector('.card')
      await user.click(card!)

      expect(onClick).toHaveBeenCalledWith(mockNote)
    })

    it('should not show action buttons when only onClick is provided', () => {
      render(
        <NoteCard
          note={mockNote}
          onClick={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /copy note/i })).not.toBeInTheDocument()
    })
  })
})
