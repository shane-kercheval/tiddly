/**
 * Tests for the unified Note component.
 *
 * Uses shared test factory for common content component behaviors,
 * plus Note-specific tests for unique functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Note } from './Note'
import { createContentComponentTests } from './__tests__/createContentComponentTests'
import type { Note as NoteType, TagCount } from '../types'

// Mock CodeMirrorEditor - now the default editor
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => (
    <textarea
      data-testid="content-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
}))

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

const mockDeletedNote: NoteType = {
  ...mockNote,
  deleted_at: '2024-01-03T00:00:00Z',
}

const mockArchivedNote: NoteType = {
  ...mockNote,
  archived_at: '2024-01-03T00:00:00Z',
}

const mockTagSuggestions: TagCount[] = [
  { name: 'test', count: 5 },
  { name: 'example', count: 3 },
  { name: 'javascript', count: 10 },
]

// Run shared content component tests
createContentComponentTests({
  componentName: 'Note',
  Component: Note,
  mockItem: mockNote,
  mockDeletedItem: mockDeletedNote,
  mockArchivedItem: mockArchivedNote,
  mockTagSuggestions,
  placeholders: {
    primaryField: 'Note title',
  },
  getPrimaryFieldValue: (note) => note.title,
  buildProps: ({ item, onSave, onClose, onArchive, onUnarchive, onDelete, viewState, isSaving }) => ({
    note: item,
    tagSuggestions: mockTagSuggestions,
    onSave,
    onClose,
    onArchive,
    onUnarchive,
    onDelete,
    viewState,
    isSaving,
  }),
})

// Note-specific tests
describe('Note component - specific behaviors', () => {
  const mockOnSave = vi.fn()
  const mockOnClose = vi.fn()
  const mockOnRestore = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('timestamps', () => {
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
  })

  describe('description field', () => {
    it('should render note description', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('Test description')).toBeInTheDocument()
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
  })

  describe('content field', () => {
    it('should enable Save button on first content keystroke', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Initially Save is disabled
      expect(screen.getByText('Save').closest('button')).toBeDisabled()

      // Type a single character in content
      const contentEditor = screen.getByTestId('content-editor')
      await user.type(contentEditor, 'x')

      // Save should be enabled after first keystroke
      expect(screen.getByText('Save').closest('button')).not.toBeDisabled()
    })

    it('should disable Save button when content is reverted to original', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      const contentEditor = screen.getByTestId('content-editor')

      // Type a character
      await user.type(contentEditor, 'x')
      expect(screen.getByText('Save').closest('button')).not.toBeDisabled()

      // Delete the character (revert to original)
      await user.type(contentEditor, '{backspace}')
      expect(screen.getByText('Save').closest('button')).toBeDisabled()
    })
  })

  describe('tags', () => {
    it('should render note tags', () => {
      render(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      expect(screen.getByText('test')).toBeInTheDocument()
      expect(screen.getByText('example')).toBeInTheDocument()
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
  })

  describe('validation', () => {
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

    it('should show validation error when form is submitted programmatically with empty title', async () => {
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

      // Submit the form directly
      const form = screen.getByText('Save').closest('form')!
      fireEvent.submit(form)

      await waitFor(() => {
        expect(screen.getByText('Title is required')).toBeInTheDocument()
      })
      expect(mockOnSave).not.toHaveBeenCalled()
    })
  })

  describe('save with only changed fields', () => {
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
  })

  describe('deleted notes', () => {
    it('should show Delete Permanently for deleted notes', () => {
      const mockOnDelete = vi.fn()
      render(
        <Note
          note={mockDeletedNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRestore={mockOnRestore}
          onDelete={mockOnDelete}
          viewState="deleted"
        />
      )

      expect(screen.getByText('Delete Permanently')).toBeInTheDocument()
    })

    it('should show Restore button for deleted notes', () => {
      render(
        <Note
          note={mockDeletedNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRestore={mockOnRestore}
          viewState="deleted"
        />
      )

      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
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
