/**
 * Tests for the unified Note component.
 *
 * Tests dirty state, save/discard flow, keyboard shortcuts, draft recovery,
 * read-only mode, and action buttons.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Note } from './Note'
import type { Note as NoteType, TagCount } from '../types'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock note data
const mockNote: NoteType = {
  id: 'note-1',
  title: 'Test Note',
  description: 'Test description',
  content: '# Hello World\n\nThis is a test note.',
  tags: ['test', 'example'],
  version: 2,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_used_at: '2024-01-02T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

const mockTagSuggestions: TagCount[] = [
  { name: 'test', count: 5 },
  { name: 'example', count: 3 },
  { name: 'javascript', count: 10 },
]

describe('Note component', () => {
  const mockOnSave = vi.fn()
  const mockOnClose = vi.fn()
  const mockOnArchive = vi.fn()
  const mockOnDelete = vi.fn()
  const mockOnUnarchive = vi.fn()
  const mockOnRestore = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('create mode', () => {
    it('should render empty form for new note', () => {
      render(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByPlaceholderText('Note title')).toHaveValue('')
      expect(screen.getByPlaceholderText('Add a description...')).toHaveValue('')
    })

    it('should show Cancel and Create buttons', () => {
      render(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Cancel')).toBeInTheDocument()
      expect(screen.getByText('Create')).toBeInTheDocument()
      // Create button is always enabled - validation happens on submit
      expect(screen.getByText('Create').closest('button')).not.toBeDisabled()
    })

    it('should show validation error when Create is clicked with empty title', async () => {
      render(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Submit the form with empty title
      fireEvent.submit(screen.getByText('Create').closest('form')!)

      await waitFor(() => {
        expect(screen.getByText('Title is required')).toBeInTheDocument()
      })
      expect(mockOnSave).not.toHaveBeenCalled()
    })

    it('should populate initial tags from props', () => {
      render(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          initialTags={['preset-tag']}
        />
      )

      expect(screen.getByText('preset-tag')).toBeInTheDocument()
    })

    it('should not show timestamps for new note', () => {
      render(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.queryByText(/Created/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
    })
  })

  describe('edit mode', () => {
    it('should populate form with note data', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByDisplayValue('Test Note')).toBeInTheDocument()
      expect(screen.getByText('Test description')).toBeInTheDocument()
      expect(screen.getByText('test')).toBeInTheDocument()
      expect(screen.getByText('example')).toBeInTheDocument()
    })

    it('should show timestamps for existing note', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText(/Created/)).toBeInTheDocument()
      expect(screen.getByText(/Updated/)).toBeInTheDocument()
    })

    it('should show version for note with version > 1', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('v2')).toBeInTheDocument()
    })

    it('should show Save button when form is dirty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Updated Title')

      expect(screen.getByText('Save')).toBeInTheDocument()
    })
  })

  describe('dirty state', () => {
    it('should always show Save button for existing notes', async () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Save button is always shown for existing notes
      expect(screen.getByText('Save')).toBeInTheDocument()
    })

    it('should detect description change as dirty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByText('Test description'))
      await user.type(screen.getByPlaceholderText('Add a description...'), 'New description')

      expect(screen.getByText('Save')).toBeInTheDocument()
    })

    it('should show Discard confirmation when Cancel is clicked with dirty form', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make dirty
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Changed')

      // Clicking Cancel shows Discard? confirmation
      await user.click(screen.getByText('Cancel'))
      expect(screen.getByText('Discard?')).toBeInTheDocument()
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('discard confirmation', () => {
    it('should close immediately when clean', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.click(screen.getByText('Cancel'))

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should show Discard? confirmation when dirty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make dirty
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Changed')

      // First click shows confirmation
      await user.click(screen.getByText('Cancel'))
      expect(screen.getByText('Discard?')).toBeInTheDocument()
      expect(mockOnClose).not.toHaveBeenCalled()
    })

    it('should close on second click within 3 seconds', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make dirty
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Changed')

      // First click
      await user.click(screen.getByText('Cancel'))
      // Second click
      await user.click(screen.getByText('Discard?'))

      expect(mockOnClose).toHaveBeenCalled()
    })

    it('should reset confirmation after 3 seconds', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make dirty
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Changed')

      // First click shows confirmation
      await user.click(screen.getByText('Cancel'))
      expect(screen.getByText('Discard?')).toBeInTheDocument()

      // Wait 3 seconds
      vi.advanceTimersByTime(3000)

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })
    })
  })

  describe('save flow', () => {
    it('should call onSave with create data for new note', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockResolvedValue(undefined)

      render(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.type(screen.getByPlaceholderText('Note title'), 'New Note')

      await user.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'New Note',
          })
        )
      })
    })

    it('should call onSave with only changed fields for existing note', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockResolvedValue(undefined)

      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Updated Title')

      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith({
          title: 'Updated Title',
        })
      })
    })

    it('should show validation error when Save is clicked with empty title', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('Test Note'))

      // Submit the form with empty title
      fireEvent.submit(screen.getByText('Save').closest('form')!)

      // Validation error should be shown
      await waitFor(() => {
        expect(screen.getByText('Title is required')).toBeInTheDocument()
      })
      expect(mockOnSave).not.toHaveBeenCalled()
    })

  })

  describe('keyboard shortcuts', () => {
    it('should save on Cmd+S when dirty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockResolvedValue(undefined)

      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Updated')

      fireEvent.keyDown(document, { key: 's', metaKey: true })

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled()
      })
    })

    it('should start discard on Escape when dirty', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Changed')

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.getByText('Discard?')).toBeInTheDocument()
    })

    it('should close on Escape when clean', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('action buttons', () => {
    it('should show Archive button for active notes', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onArchive={mockOnArchive}
          viewState="active"
        />
      )

      expect(screen.getByText('Archive')).toBeInTheDocument()
    })

    it('should show Restore button for archived notes', () => {
      render(
        <Note
          note={{ ...mockNote, archived_at: '2024-01-03T00:00:00Z' }}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onUnarchive={mockOnUnarchive}
          viewState="archived"
        />
      )

      expect(screen.getByText('Restore')).toBeInTheDocument()
    })

    it('should show Delete button', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onDelete={mockOnDelete}
        />
      )

      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('should show Delete Permanently for deleted notes', () => {
      render(
        <Note
          note={{ ...mockNote, deleted_at: '2024-01-03T00:00:00Z' }}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onDelete={mockOnDelete}
          onRestore={mockOnRestore}
          viewState="deleted"
        />
      )

      expect(screen.getByText('Delete Permanently')).toBeInTheDocument()
    })

    it('should call onArchive when Archive is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onArchive={mockOnArchive}
          viewState="active"
        />
      )

      await user.click(screen.getByText('Archive'))

      expect(mockOnArchive).toHaveBeenCalled()
    })
  })

  describe('read-only mode', () => {
    it('should disable all fields for deleted notes', () => {
      render(
        <Note
          note={{ ...mockNote, deleted_at: '2024-01-03T00:00:00Z' }}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          viewState="deleted"
        />
      )

      expect(screen.getByDisplayValue('Test Note')).toBeDisabled()
      expect(screen.getByText('Test description').closest('textarea')).toBeDisabled()
    })

    it('should show read-only banner for deleted notes', () => {
      render(
        <Note
          note={{ ...mockNote, deleted_at: '2024-01-03T00:00:00Z' }}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          viewState="deleted"
        />
      )

      expect(screen.getByText(/in trash and cannot be edited/)).toBeInTheDocument()
    })

    it('should NOT disable fields for archived notes', () => {
      render(
        <Note
          note={{ ...mockNote, archived_at: '2024-01-03T00:00:00Z' }}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          viewState="archived"
        />
      )

      expect(screen.getByDisplayValue('Test Note')).not.toBeDisabled()
    })
  })

  describe('draft recovery', () => {
    it('should show draft recovery prompt when draft exists', () => {
      const draftData = {
        title: 'Draft Title',
        description: 'Draft description',
        content: 'Draft content',
        tags: ['draft-tag'],
        savedAt: Date.now(),
      }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(draftData))

      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText(/unsaved draft from a previous session/)).toBeInTheDocument()
      expect(screen.getByText('Restore Draft')).toBeInTheDocument()
    })

    it('should restore draft when Restore Draft is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const draftData = {
        title: 'Draft Title',
        description: 'Draft description',
        content: 'Draft content',
        tags: ['draft-tag'],
        savedAt: Date.now(),
      }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(draftData))

      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      await user.click(screen.getByText('Restore Draft'))

      expect(screen.getByDisplayValue('Draft Title')).toBeInTheDocument()
    })

    it('should clear draft prompt when Discard is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const draftData = {
        title: 'Draft Title',
        description: 'Draft description',
        content: 'Draft content',
        tags: ['draft-tag'],
        savedAt: Date.now(),
      }
      localStorageMock.getItem.mockReturnValue(JSON.stringify(draftData))

      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Click the discard button in the draft prompt (different from the main Discard)
      const discardButtons = screen.getAllByRole('button', { name: /discard/i })
      await user.click(discardButtons[0]) // First one is in the draft prompt

      expect(screen.queryByText(/unsaved draft/)).not.toBeInTheDocument()
    })
  })

  describe('fullWidth prop', () => {
    it('should apply max-w-4xl when fullWidth is false', () => {
      const { container } = render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          fullWidth={false}
        />
      )

      expect(container.querySelector('form')).toHaveClass('max-w-4xl')
    })

    it('should not apply max-w-4xl when fullWidth is true', () => {
      const { container } = render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          fullWidth={true}
        />
      )

      expect(container.querySelector('form')).not.toHaveClass('max-w-4xl')
    })
  })
})
