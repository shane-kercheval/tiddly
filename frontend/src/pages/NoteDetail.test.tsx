/**
 * Tests for NoteDetail page.
 *
 * Tests the unified Note component for creating and editing notes.
 * The unified component is always editable - there's no separate view/edit mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom'
import { NoteDetail } from './NoteDetail'
import type { Note } from '../types'

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock @tanstack/react-query's useQueryClient
const mockInvalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}))

// Mock note data
const mockNote: Note = {
  id: '1',
  title: 'Test Note',
  description: 'Test description',
  content: '# Hello World\n\nThis is a test note.',
  tags: ['test', 'example'],
  version: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  archived_at: null,
  content_preview: null,
}

// Mock hooks
const mockFetchNote = vi.fn()
const mockTrackNoteUsage = vi.fn()
const mockTrackBookmarkUsage = vi.fn()
const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()
const mockDeleteMutateAsync = vi.fn()
const mockArchiveMutateAsync = vi.fn()
const mockUnarchiveMutateAsync = vi.fn()
const mockRestoreMutateAsync = vi.fn()
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../hooks/useNotes', () => ({
  useNotes: () => ({
    fetchNote: mockFetchNote,
    trackNoteUsage: mockTrackNoteUsage,
  }),
}))

vi.mock('../hooks/useBookmarks', () => ({
  useBookmarks: () => ({
    trackBookmarkUsage: mockTrackBookmarkUsage,
  }),
}))

vi.mock('../hooks/useNoteMutations', () => ({
  useCreateNote: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUpdateNote: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
  useDeleteNote: () => ({
    mutateAsync: mockDeleteMutateAsync,
  }),
  useRestoreNote: () => ({
    mutateAsync: mockRestoreMutateAsync,
  }),
  useArchiveNote: () => ({
    mutateAsync: mockArchiveMutateAsync,
  }),
  useUnarchiveNote: () => ({
    mutateAsync: mockUnarchiveMutateAsync,
  }),
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: () => ({
    tags: [
      { name: 'test', content_count: 5, filter_count: 0 },
      { name: 'example', content_count: 3, filter_count: 0 },
    ],
  }),
}))

vi.mock('../stores/tagFilterStore', () => ({
  useTagFilterStore: Object.assign(
    (selector?: (state: Record<string, unknown>) => unknown) => {
      const state = {
        getSelectedTags: () => [],
        addTag: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getSelectedTags: () => [],
        addTag: vi.fn(),
      }),
    }
  ),
}))

vi.mock('../stores/uiPreferencesStore', () => ({
  useUIPreferencesStore: (selector: (state: { fullWidthLayout: boolean }) => boolean) =>
    selector({ fullWidthLayout: false }),
}))

// Mock content query hook (used by LinkedContentChips inline search)
vi.mock('../hooks/useContentQuery', () => ({
  useContentQuery: () => ({ data: null, isFetching: false }),
  contentKeys: { all: ['content'], lists: () => ['content', 'list'], view: () => ['content', 'list', 'active'], list: () => ['content', 'list', 'active'] },
}))

// Mock ContentEditor to avoid Milkdown timer issues in tests
// Milkdown's internal timers try to call removeEventListener after test environment teardown
vi.mock('../components/ContentEditor', () => ({
  ContentEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea
      data-testid="content-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

// Helper to render NoteDetail with router
// Single route entry matches actual App.tsx — separate entries would mask remount bugs
function renderWithRouter(initialRoute: string): void {
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/app/notes/:id" element={<NoteDetail />} />
        <Route path="/app/notes" element={<div>Notes List</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('NoteDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchNote.mockResolvedValue(mockNote)
  })

  describe('create mode', () => {
    it('should render create form for /app/notes/new', async () => {
      renderWithRouter('/app/notes/new')

      await waitFor(() => {
        // Create mode shows the unified Note component with Close button
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('should not fetch note in create mode', async () => {
      renderWithRouter('/app/notes/new')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })

      expect(mockFetchNote).not.toHaveBeenCalled()
    })

    it('should show Close button', async () => {
      renderWithRouter('/app/notes/new')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('should show Create button when form is dirty', async () => {
      const user = userEvent.setup()
      renderWithRouter('/app/notes/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Note title')).toBeInTheDocument()
      })

      // Type in title to make form dirty
      await user.type(screen.getByPlaceholderText('Note title'), 'New Note Title')

      await waitFor(() => {
        expect(screen.getByText('Create')).toBeInTheDocument()
      })
    })

    it('should show Discard? confirmation when Close is clicked with dirty form', async () => {
      const user = userEvent.setup()
      renderWithRouter('/app/notes/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Note title')).toBeInTheDocument()
      })

      // Type in title to make form dirty
      await user.type(screen.getByPlaceholderText('Note title'), 'New Note Title')

      // Click Close to trigger confirmation
      await user.click(screen.getByText('Close'))

      await waitFor(() => {
        expect(screen.getByText('Discard?')).toBeInTheDocument()
      })
    })
  })

  describe('existing note', () => {
    it('should fetch note by ID', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(mockFetchNote).toHaveBeenCalledWith('1')
      })
    })

    it('should track note usage', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(mockTrackNoteUsage).toHaveBeenCalledWith('1')
      })
    })

    it('should render note title in editable field', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Note')).toBeInTheDocument()
      })
    })

    it('should render note description', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByText('Test description')).toBeInTheDocument()
      })
    })

    it('should render note tags', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByText('test')).toBeInTheDocument()
        expect(screen.getByText('example')).toBeInTheDocument()
      })
    })

    it('should show Close button', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('should show archive button for active notes', async () => {
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByText('Archive')).toBeInTheDocument()
      })
    })

    it('should show Save button when form is dirty', async () => {
      const user = userEvent.setup()
      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Note')).toBeInTheDocument()
      })

      // Modify title to make form dirty
      await user.clear(screen.getByDisplayValue('Test Note'))
      await user.type(screen.getByPlaceholderText('Note title'), 'Updated Title')

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('should show error state when note fetch fails', async () => {
      mockFetchNote.mockRejectedValue(new Error('Network error'))

      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should show error when API returns not found', async () => {
      const notFoundError = { response: { status: 404 } }
      mockFetchNote.mockRejectedValue(notFoundError)
      renderWithRouter('/app/notes/invalid-uuid')

      await waitFor(() => {
        expect(screen.getByText('This note does not exist')).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner while fetching note', async () => {
      mockFetchNote.mockImplementation(() => new Promise(() => {})) // Never resolves

      renderWithRouter('/app/notes/1')

      expect(screen.getByText('Loading note...')).toBeInTheDocument()
    })
  })

  describe('navigation', () => {
    it('should navigate to list when close is clicked', async () => {
      const user = userEvent.setup()

      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Close'))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
    })
  })

  describe('optimistic navigation', () => {
    it('should navigate immediately on archive', async () => {
      const user = userEvent.setup()
      mockArchiveMutateAsync.mockResolvedValue({ ...mockNote, archived_at: '2024-01-02T00:00:00Z' })

      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByLabelText('Archive')).toBeInTheDocument()
      })

      await user.click(screen.getByLabelText('Archive'))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
      expect(mockArchiveMutateAsync).toHaveBeenCalledWith('1')
    })

    it('should navigate immediately on delete', async () => {
      const user = userEvent.setup()
      mockDeleteMutateAsync.mockResolvedValue(undefined)

      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /delete/i }))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: '1', permanent: false })
    })

    it('should navigate immediately on restore', async () => {
      const user = userEvent.setup()
      const deletedNote = { ...mockNote, deleted_at: '2024-01-02T00:00:00Z' }
      mockFetchNote.mockResolvedValue(deletedNote)
      mockRestoreMutateAsync.mockResolvedValue({ ...mockNote, deleted_at: null })

      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /restore/i }))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
      expect(mockRestoreMutateAsync).toHaveBeenCalledWith('1')
    })

    it('should navigate immediately on unarchive', async () => {
      const user = userEvent.setup()
      const archivedNote = { ...mockNote, archived_at: '2024-01-02T00:00:00Z' }
      mockFetchNote.mockResolvedValue(archivedNote)
      mockUnarchiveMutateAsync.mockResolvedValue({ ...mockNote, archived_at: null })

      renderWithRouter('/app/notes/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /restore/i }))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
      expect(mockUnarchiveMutateAsync).toHaveBeenCalledWith('1')
    })
  })

  describe('create then stay on page', () => {
    it('should navigate to note URL with state after creating', async () => {
      const user = userEvent.setup()
      const createdNote = { ...mockNote, id: 'new-note-id', title: 'New Note' }
      mockCreateMutateAsync.mockResolvedValue(createdNote)

      renderWithRouter('/app/notes/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Note title')).toBeInTheDocument()
      })

      // Fill in required field
      await user.type(screen.getByPlaceholderText('Note title'), 'New Note')

      // Submit the form
      await user.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/app/notes/new-note-id',
          {
            replace: true,
            state: { note: createdNote, fromCreate: true },
          }
        )
      })
    })

    it('should use note from location state instead of fetching', async () => {
      const passedNote = { ...mockNote, id: '123', title: 'Passed Note' }

      render(
        <MemoryRouter
          initialEntries={[{ pathname: '/app/notes/123', state: { note: passedNote } }]}
        >
          <Routes>
            <Route path="/app/notes/:id" element={<NoteDetail />} />
          </Routes>
        </MemoryRouter>
      )

      // Should immediately display the passed note without error flash
      // This must NOT use waitFor - we're testing there's no flash before state syncs
      expect(screen.queryByText('Note not found')).not.toBeInTheDocument()
      expect(screen.getByDisplayValue('Passed Note')).toBeInTheDocument()

      // Should NOT have called fetchNote since we passed the note
      expect(mockFetchNote).not.toHaveBeenCalled()

      // Should still track usage
      expect(mockTrackNoteUsage).toHaveBeenCalledWith('123')
    })

    it('should fetch note if passed note ID does not match route ID', async () => {
      const passedNote = { ...mockNote, id: 'different-id', title: 'Wrong Note' }

      render(
        <MemoryRouter
          initialEntries={[{ pathname: '/app/notes/123', state: { note: passedNote } }]}
        >
          <Routes>
            <Route path="/app/notes/:id" element={<NoteDetail />} />
          </Routes>
        </MemoryRouter>
      )

      // Should fetch since IDs don't match
      await waitFor(() => {
        expect(mockFetchNote).toHaveBeenCalledWith('123')
      })
    })
  })

  describe('error to create transition', () => {
    it('should clear error state when navigating from failed load to /new', async () => {
      const user = userEvent.setup()
      mockFetchNote.mockRejectedValue(new Error('Network error'))

      // Use Link to navigate — useNavigate is mocked to a spy
      render(
        <MemoryRouter initialEntries={['/app/notes/bad-id']}>
          <Routes>
            <Route path="/app/notes/:id" element={
              <>
                <NoteDetail />
                <Link to="/app/notes/new">New Note</Link>
              </>
            } />
          </Routes>
        </MemoryRouter>
      )

      // Wait for error state to appear
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })

      // Navigate to create mode
      await user.click(screen.getByText('New Note'))

      // Should show create form, not stale error
      await waitFor(() => {
        expect(screen.queryByText('Network error')).not.toBeInTheDocument()
        expect(screen.getByPlaceholderText('Note title')).toBeInTheDocument()
      })
    })
  })

  describe('edit to create transition', () => {
    it('should reset to create mode when navigating from existing note to /new', async () => {
      const user = userEvent.setup()

      // Use Link (not useNavigate) because useNavigate is mocked to a spy.
      // Link uses real React Router internals and triggers actual navigation.
      render(
        <MemoryRouter initialEntries={['/app/notes/1']}>
          <Routes>
            <Route path="/app/notes/:id" element={
              <>
                <NoteDetail />
                <Link to="/app/notes/new">New Note</Link>
              </>
            } />
          </Routes>
        </MemoryRouter>
      )

      // Wait for existing note to load
      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Note')).toBeInTheDocument()
      })

      // Navigate to create mode
      await user.click(screen.getByText('New Note'))

      // Should show create mode — empty title, no stale data
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Note title')).toHaveValue('')
      })

      // Should show Create button (not Save), confirming we're in create mode
      // Form is clean so Create button won't appear until dirty — just verify no Save button
      expect(screen.queryByText('Save')).not.toBeInTheDocument()
    })
  })

  describe('create to existing transition without fromCreate', () => {
    it('should load existing note when navigating from /new to /:id without fromCreate', async () => {
      const user = userEvent.setup()

      // Navigate from /new to an existing note (e.g., via browser back) without
      // the fromCreate flag — this is NOT a create-save transition, so state should reset.
      render(
        <MemoryRouter initialEntries={['/app/notes/new']}>
          <Routes>
            <Route path="/app/notes/:id" element={
              <>
                <NoteDetail />
                <Link to="/app/notes/1">Existing Note</Link>
              </>
            } />
          </Routes>
        </MemoryRouter>
      )

      // Wait for create form
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Note title')).toHaveValue('')
      })

      // Navigate to existing note (no fromCreate in location state)
      await user.click(screen.getByText('Existing Note'))

      // Should load the existing note's data
      await waitFor(() => {
        expect(screen.getByDisplayValue('Test Note')).toBeInTheDocument()
      })
    })
  })
})
