/**
 * Tests for the unified Note component.
 *
 * Uses shared test factory for common content component behaviors,
 * plus Note-specific tests for unique functionality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import userEvent from '@testing-library/user-event'
import axios from 'axios'
import { renderWithRouter } from '../test-utils'
import { Note } from './Note'
import { createContentComponentTests } from './__tests__/createContentComponentTests'
import type { Note as NoteType, TagCount } from '../types'

// Mock axios.isAxiosError
vi.mock('axios', async () => {
  const actual = await vi.importActual('axios')
  return {
    ...actual,
    default: {
      ...(actual as { default: typeof axios }).default,
      isAxiosError: vi.fn(),
    },
  }
})

let editorInstanceCounter = 0

// Mock CodeMirrorEditor - now the default editor
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, placeholder, disabled }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
  }) => {
    const instanceRef = useRef<number | null>(null)
    if (instanceRef.current === null) {
      editorInstanceCounter += 1
      instanceRef.current = editorInstanceCounter
    }
    return (
      <textarea
        data-testid="content-editor"
        data-editor-instance={instanceRef.current}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    )
  },
}))

// Mock content query hook (used by LinkedContentChips inline search)
vi.mock('../hooks/useContentQuery', () => ({
  useContentQuery: () => ({ data: null, isFetching: false }),
  contentKeys: { all: ['content'], lists: () => ['content', 'list'], view: () => ['content', 'list', 'active'], list: () => ['content', 'list', 'active'] },
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
  content_preview: null,
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
  { name: 'test', content_count: 5, filter_count: 0 },
  { name: 'example', content_count: 3, filter_count: 0 },
  { name: 'javascript', content_count: 10, filter_count: 0 },
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
    editorInstanceCounter = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('timestamps', () => {
    it('should not show timestamps for new note', () => {
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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
      renderWithRouter(
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

      renderWithRouter(
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
          expected_updated_at: '2024-01-02T00:00:00Z',
        })
      })
    })
  })

  describe('deleted notes', () => {
    it('should show Delete Permanently for deleted notes', () => {
      const mockOnDelete = vi.fn()
      renderWithRouter(
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
      renderWithRouter(
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
      const { container } = renderWithRouter(
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
      const { container } = renderWithRouter(
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

  describe('prop sync on refresh', () => {
    it('should update internal state when note prop updated_at changes', () => {
      const { rerender } = renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Initial state shows mock note values
      expect(screen.getByDisplayValue('Test Note')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test description')).toBeInTheDocument()

      // Simulate refresh by passing new note with updated values and different updated_at
      const updatedNote: NoteType = {
        ...mockNote,
        title: 'Refreshed Title',
        description: 'Refreshed description',
        updated_at: '2024-01-05T00:00:00Z', // Different from mockNote
      }

      rerender(
        <Note
          note={updatedNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // State should be updated to reflect new note values
      expect(screen.getByDisplayValue('Refreshed Title')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Refreshed description')).toBeInTheDocument()
    })

    it('should not update internal state when note prop changes without updated_at change', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { rerender } = renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // User makes local edits
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My Local Edit')

      // Parent re-renders with same updated_at (e.g., tag suggestions changed)
      const sameNote: NoteType = {
        ...mockNote, // Same updated_at
      }

      rerender(
        <Note
          note={sameNote}
          tagSuggestions={[]} // Different tag suggestions
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Local edits should be preserved (state not reset)
      expect(screen.getByDisplayValue('My Local Edit')).toBeInTheDocument()
    })

    it('should clear conflict state when note prop updated_at changes', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      vi.mocked(axios.isAxiosError).mockReturnValue(true)
      const error409 = new Error('Conflict') as Error & { response?: { status: number; data: { detail: { error: string; server_state: NoteType } } } }
      error409.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: { ...mockNote, updated_at: '2024-01-03T00:00:00Z' },
          },
        },
      }
      mockOnSave.mockRejectedValue(error409)

      const { rerender } = renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make edit and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My Edit')
      await user.click(screen.getByText('Save'))

      // ConflictDialog should appear
      await waitFor(() => {
        expect(screen.getByText('Save Conflict')).toBeInTheDocument()
      })

      // Simulate refresh with new note (updated_at changes)
      const refreshedNote: NoteType = {
        ...mockNote,
        title: 'Server Title',
        updated_at: '2024-01-05T00:00:00Z',
      }

      rerender(
        <Note
          note={refreshedNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // ConflictDialog should be cleared
      expect(screen.queryByText('Save Conflict')).not.toBeInTheDocument()
      // State should reflect refreshed note
      expect(screen.getByDisplayValue('Server Title')).toBeInTheDocument()
    })
  })

  describe('load server version', () => {
    it('should remount editor when Load Latest Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      vi.mocked(axios.isAxiosError).mockReturnValue(true)
      const error409 = new Error('Conflict') as Error & {
        response?: { status: number; data: { detail: { error: string; server_state: NoteType } } }
      }
      error409.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: { ...mockNote, updated_at: '2024-01-03T00:00:00Z' },
          },
        },
      }
      mockOnSave.mockRejectedValue(error409)

      const refreshedNote: NoteType = {
        ...mockNote,
        content: 'Server content',
        updated_at: mockNote.updated_at,
      }
      const mockOnRefresh = vi.fn().mockResolvedValue(refreshedNote)

      renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRefresh={mockOnRefresh}
        />
      )

      const initialEditor = screen.getByTestId('content-editor')
      const initialInstance = initialEditor.getAttribute('data-editor-instance')

      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My Edit')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByText('Save Conflict')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Load Latest Version' }))

      await waitFor(() => {
        expect(screen.getByDisplayValue('Server content')).toBeInTheDocument()
      })

      const refreshedEditor = screen.getByTestId('content-editor')
      const refreshedInstance = refreshedEditor.getAttribute('data-editor-instance')
      expect(refreshedInstance).not.toBe(initialInstance)
    })
  })

  describe('editor focus on save', () => {
    it('should keep focus on editor after Cmd+S save', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockResolvedValue(undefined)

      renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      const editor = screen.getByTestId('content-editor')
      editor.focus()
      expect(document.activeElement).toBe(editor)

      await user.type(editor, 'x')

      fireEvent.keyDown(document, { key: 's', metaKey: true })

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled()
      })

      const editorAfterSave = screen.getByTestId('content-editor')
      expect(document.activeElement).toBe(editorAfterSave)
    })
  })

  describe('409 Conflict handling', () => {
    const create409Error = (): Error & { response?: { status: number; data: { detail: { error: string; server_state: NoteType } } } } => {
      const error = new Error('Conflict') as Error & { response?: { status: number; data: { detail: { error: string; server_state: NoteType } } } }
      error.response = {
        status: 409,
        data: {
          detail: {
            error: 'conflict',
            server_state: {
              ...mockNote,
              title: 'Server Updated Title',
              updated_at: '2024-01-03T00:00:00Z',
            },
          },
        },
      }
      return error
    }

    beforeEach(() => {
      vi.mocked(axios.isAxiosError).mockReturnValue(true)
    })

    it('should show ConflictDialog when save returns 409', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())

      renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My New Title')
      await user.click(screen.getByText('Save'))

      // ConflictDialog should appear
      await waitFor(() => {
        expect(screen.getByText('Save Conflict')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Load Latest Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
    })

    it('should call onRefresh when Load Latest Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())
      const mockOnRefresh = vi.fn().mockResolvedValue(mockNote)

      renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
          onRefresh={mockOnRefresh}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My New Title')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Load Latest Version' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Load Latest Version' }))

      expect(mockOnRefresh).toHaveBeenCalledTimes(1)
    })

    it('should force save without expected_updated_at when Save My Version is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      // First call rejects with 409, second call succeeds
      mockOnSave.mockRejectedValueOnce(create409Error()).mockResolvedValueOnce(undefined)

      renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My New Title')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save My Version' })).toBeInTheDocument()
      })

      // First click shows confirmation
      await user.click(screen.getByRole('button', { name: 'Save My Version' }))
      expect(screen.getByRole('button', { name: 'Confirm Overwrite?' })).toBeInTheDocument()

      // Second click confirms and saves
      await user.click(screen.getByRole('button', { name: 'Confirm Overwrite?' }))

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledTimes(2)
      })

      // Second call should NOT include expected_updated_at (force save)
      const secondCall = mockOnSave.mock.calls[1][0]
      expect(secondCall).not.toHaveProperty('expected_updated_at')
      expect(secondCall).toHaveProperty('title', 'My New Title')
    })

    it('should close ConflictDialog without action when Do Nothing is clicked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockOnSave.mockRejectedValue(create409Error())

      renderWithRouter(
        <Note
          note={mockNote}
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={mockOnClose}
        />
      )

      // Make a change and save to trigger conflict
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'My New Title')
      await user.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Do Nothing' })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: 'Do Nothing' }))

      // Dialog should close but changes should remain
      await waitFor(() => {
        expect(screen.queryByText('Save Conflict')).not.toBeInTheDocument()
      })

      // User's changes should still be in the form
      expect(screen.getByDisplayValue('My New Title')).toBeInTheDocument()
    })
  })

  describe('pre-populated relationships (quick-create linked)', () => {
    it('should not make form dirty when initialRelationships are provided in create mode', () => {
      renderWithRouter(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={vi.fn()}
          initialRelationships={[{
            target_type: 'bookmark',
            target_id: 'bm-1',
            relationship_type: 'related',
          }]}
          initialLinkedItems={[{
            relationshipId: '',
            type: 'bookmark',
            id: 'bm-1',
            title: 'My Bookmark',
            url: 'https://example.com',
            deleted: false,
            archived: false,
            description: null,
          }]}
        />
      )

      // The pre-populated link chip should be visible
      expect(screen.getByText('My Bookmark')).toBeInTheDocument()

      // But the Create button should be disabled (form not dirty from pre-populated link alone)
      const createButton = screen.getByText('Create').closest('button')
      expect(createButton).toBeDisabled()
    })

    it('should become dirty when pre-populated relationship is removed', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderWithRouter(
        <Note
          tagSuggestions={mockTagSuggestions}
          onSave={mockOnSave}
          onClose={vi.fn()}
          initialRelationships={[{
            target_type: 'bookmark',
            target_id: 'bm-1',
            relationship_type: 'related',
          }]}
          initialLinkedItems={[{
            relationshipId: '',
            type: 'bookmark',
            id: 'bm-1',
            title: 'My Bookmark',
            url: 'https://example.com',
            deleted: false,
            archived: false,
            description: null,
          }]}
        />
      )

      // Remove the pre-populated link — hover to reveal the remove button
      const removeButton = screen.getByLabelText('Remove link to My Bookmark')
      await user.click(removeButton)

      // Now the form is dirty — but Create is still disabled because title is empty (invalid)
      expect(screen.queryByText('My Bookmark')).not.toBeInTheDocument()
    })
  })
})
