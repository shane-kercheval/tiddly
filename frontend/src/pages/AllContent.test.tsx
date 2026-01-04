/**
 * Tests for AllContent page.
 *
 * Covers:
 * - View-specific empty states
 * - QuickAddMenu visibility
 * - URL action parameter handling
 * - View-specific action buttons
 * - Content type rendering (bookmarks vs notes)
 * - Note navigation with return state
 * - Pagination
 * - Tag filtering
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AllContent } from './AllContent'
import type { ContentListItem, ContentListResponse } from '../types'

// Mock data
const mockBookmark: ContentListItem = {
  type: 'bookmark',
  id: 1,
  title: 'Test Bookmark',
  description: 'A test bookmark description',
  tags: ['test', 'bookmark'],
  url: 'https://example.com',
  version: null,
  name: null,
  arguments: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

const mockNote: ContentListItem = {
  type: 'note',
  id: 2,
  title: 'Test Note',
  description: 'A test note description',
  tags: ['test', 'note'],
  url: null,
  version: 1,
  name: null,
  arguments: null,
  created_at: '2024-01-02T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_used_at: '2024-01-02T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

const mockArchivedBookmark: ContentListItem = {
  ...mockBookmark,
  id: 3,
  title: 'Archived Bookmark',
  archived_at: '2024-01-05T00:00:00Z',
}

const mockDeletedNote: ContentListItem = {
  ...mockNote,
  id: 4,
  title: 'Deleted Note',
  deleted_at: '2024-01-06T00:00:00Z',
}

// Mock response builders
function createMockResponse(items: ContentListItem[]): ContentListResponse {
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 20,
    has_more: false,
  }
}

// Track navigation calls
const mockNavigate = vi.fn()

// Mock hooks and stores
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Content query mock - will be configured per test
const mockRefetch = vi.fn()
let mockContentQueryData: ContentListResponse = createMockResponse([])
let mockContentQueryLoading = false
let mockContentQueryError: Error | null = null

vi.mock('../hooks/useContentQuery', () => ({
  useContentQuery: () => ({
    data: mockContentQueryData,
    isLoading: mockContentQueryLoading,
    isFetching: false,
    error: mockContentQueryError,
    refetch: mockRefetch,
  }),
}))

vi.mock('../hooks/useBookmarks', () => ({
  useBookmarks: () => ({
    fetchBookmark: vi.fn().mockResolvedValue(mockBookmark),
    fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null, content: null, error: null }),
    trackBookmarkUsage: vi.fn(),
  }),
}))

const mockCreateBookmark = vi.fn()
const mockUpdateBookmark = vi.fn()
const mockDeleteBookmark = vi.fn()
const mockRestoreBookmark = vi.fn()
const mockArchiveBookmark = vi.fn()
const mockUnarchiveBookmark = vi.fn()

vi.mock('../hooks/useBookmarkMutations', () => ({
  useCreateBookmark: () => ({ mutateAsync: mockCreateBookmark, isPending: false }),
  useUpdateBookmark: () => ({ mutateAsync: mockUpdateBookmark, isPending: false }),
  useDeleteBookmark: () => ({ mutateAsync: mockDeleteBookmark, isPending: false }),
  useRestoreBookmark: () => ({ mutateAsync: mockRestoreBookmark, isPending: false }),
  useArchiveBookmark: () => ({ mutateAsync: mockArchiveBookmark, isPending: false }),
  useUnarchiveBookmark: () => ({ mutateAsync: mockUnarchiveBookmark, isPending: false }),
}))

const mockDeleteNote = vi.fn()
const mockRestoreNote = vi.fn()
const mockArchiveNote = vi.fn()
const mockUnarchiveNote = vi.fn()

vi.mock('../hooks/useNoteMutations', () => ({
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteNote: () => ({ mutateAsync: mockDeleteNote, isPending: false }),
  useRestoreNote: () => ({ mutateAsync: mockRestoreNote, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: mockArchiveNote, isPending: false }),
  useUnarchiveNote: () => ({ mutateAsync: mockUnarchiveNote, isPending: false }),
}))

const mockDeletePrompt = vi.fn()
const mockRestorePrompt = vi.fn()
const mockArchivePrompt = vi.fn()
const mockUnarchivePrompt = vi.fn()

vi.mock('../hooks/usePromptMutations', () => ({
  useCreatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePrompt: () => ({ mutateAsync: mockDeletePrompt, isPending: false }),
  useRestorePrompt: () => ({ mutateAsync: mockRestorePrompt, isPending: false }),
  useArchivePrompt: () => ({ mutateAsync: mockArchivePrompt, isPending: false }),
  useUnarchivePrompt: () => ({ mutateAsync: mockUnarchivePrompt, isPending: false }),
}))

vi.mock('../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => {},
}))

vi.mock('../hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: string) => value,
}))

vi.mock('../hooks/useEffectiveSort', () => ({
  useEffectiveSort: () => ({
    sortBy: 'updated_at',
    sortOrder: 'desc',
    setSort: vi.fn(),
    availableSortOptions: ['updated_at', 'created_at', 'last_used_at', 'title'],
  }),
  getViewKey: (view: string, listId?: number) => listId ? `list-${listId}` : view,
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: () => ({
    tags: [{ name: 'test', count: 5 }, { name: 'example', count: 3 }],
  }),
}))

const mockAddTag = vi.fn()
const mockRemoveTag = vi.fn()
const mockSetTagMatch = vi.fn()
const mockClearTagFilters = vi.fn()
let mockSelectedTags: string[] = []

vi.mock('../stores/tagFilterStore', () => ({
  useTagFilterStore: () => ({
    selectedTags: mockSelectedTags,
    tagMatch: 'all',
    addTag: mockAddTag,
    removeTag: mockRemoveTag,
    setTagMatch: mockSetTagMatch,
    clearFilters: mockClearTagFilters,
  }),
}))

vi.mock('../stores/uiPreferencesStore', () => ({
  PAGE_SIZE_OPTIONS: [10, 15, 20, 30, 50],
  useUIPreferencesStore: () => ({
    pageSize: 20,
    setPageSize: vi.fn(),
  }),
}))

const mockToggleType = vi.fn()
let mockSelectedContentTypes: ('bookmark' | 'note' | 'prompt')[] = ['bookmark', 'note', 'prompt']

vi.mock('../stores/contentTypeFilterStore', () => ({
  ALL_CONTENT_TYPES: ['bookmark', 'note', 'prompt'],
  useContentTypeFilterStore: () => ({
    getSelectedTypes: () => mockSelectedContentTypes,
    toggleType: mockToggleType,
  }),
}))

vi.mock('../stores/listsStore', () => ({
  useListsStore: () => ({
    lists: [
      {
        id: 1,
        name: 'Reading List',
        content_types: ['bookmark'],
        filter_expression: { groups: [{ tags: ['list-tag-1', 'list-tag-2'], operator: 'AND' }], group_operator: 'OR' },
        default_sort_by: null,
        default_sort_ascending: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        name: 'Ideas',
        content_types: ['note'],
        filter_expression: { groups: [], group_operator: 'OR' },
        default_sort_by: null,
        default_sort_ascending: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 3,
        name: 'Mixed',
        content_types: ['bookmark', 'note'],
        filter_expression: { groups: [], group_operator: 'OR' },
        default_sort_by: null,
        default_sort_ascending: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ],
  }),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}))

// Helper to render AllContent with router at specific route
function renderAtRoute(route: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/app/content" element={<AllContent />} />
        <Route path="/app/content/archived" element={<AllContent />} />
        <Route path="/app/content/trash" element={<AllContent />} />
        <Route path="/app/content/lists/:listId" element={<AllContent />} />
        <Route path="/app/notes/:id" element={<div data-testid="note-detail">Note Detail</div>} />
        <Route path="/app/notes/:id/edit" element={<div data-testid="note-edit">Note Edit</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AllContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContentQueryData = createMockResponse([])
    mockContentQueryLoading = false
    mockContentQueryError = null
    mockSelectedTags = []
    mockSelectedContentTypes = ['bookmark', 'note', 'prompt']
  })

  describe('view-specific empty states', () => {
    it('shows "No content yet" for active view with no content', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('No content yet')).toBeInTheDocument()
      })
      expect(screen.getByText('Create content to see it here.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New Bookmark' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New Note' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New Prompt' })).toBeInTheDocument()
    })

    it('shows "No archived content" for archived view with no content', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content/archived')

      await waitFor(() => {
        expect(screen.getByText('No archived content')).toBeInTheDocument()
      })
      expect(screen.getByText('Content you archive will appear here.')).toBeInTheDocument()
    })

    it('shows "Trash is empty" for deleted view with no content', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content/trash')

      await waitFor(() => {
        expect(screen.getByText('Trash is empty')).toBeInTheDocument()
      })
      expect(screen.getByText('Items in trash are permanently deleted after 30 days.')).toBeInTheDocument()
    })

    it('shows "No content found" when search filters match nothing in active view', async () => {
      mockContentQueryData = createMockResponse([])
      mockSelectedTags = ['nonexistent']
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('No content found')).toBeInTheDocument()
      })
      expect(screen.getByText('Try adjusting your search or filter.')).toBeInTheDocument()
    })

    it('shows "No archived content found" when filters match nothing in archived view', async () => {
      mockContentQueryData = createMockResponse([])
      mockSelectedTags = ['nonexistent']
      renderAtRoute('/app/content/archived')

      await waitFor(() => {
        expect(screen.getByText('No archived content found')).toBeInTheDocument()
      })
    })

    it('shows "No deleted content found" when filters match nothing in trash view', async () => {
      mockContentQueryData = createMockResponse([])
      mockSelectedTags = ['nonexistent']
      renderAtRoute('/app/content/trash')

      await waitFor(() => {
        expect(screen.getByText('No deleted content found')).toBeInTheDocument()
      })
    })

    it('shows bookmark-only empty state in custom list view', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content/lists/1')

      await waitFor(() => {
        expect(screen.getByText('No bookmarks yet')).toBeInTheDocument()
      })
      expect(screen.getByText('Create bookmarks to see them here.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New Bookmark' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'New Note' })).not.toBeInTheDocument()
    })
  })

  describe('QuickAddMenu visibility', () => {
    it('shows QuickAddMenu in active view', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByTestId('quick-add-menu-trigger')).toBeInTheDocument()
      })
    })

    it('hides QuickAddMenu in archived view', async () => {
      mockContentQueryData = createMockResponse([mockArchivedBookmark])
      renderAtRoute('/app/content/archived')

      await waitFor(() => {
        expect(screen.queryByTestId('quick-add-menu-trigger')).not.toBeInTheDocument()
      })
    })

    it('hides QuickAddMenu in deleted view', async () => {
      mockContentQueryData = createMockResponse([mockDeletedNote])
      renderAtRoute('/app/content/trash')

      await waitFor(() => {
        expect(screen.queryByTestId('quick-add-menu-trigger')).not.toBeInTheDocument()
      })
    })

    it('shows QuickAddMenu in custom list view with mixed content types', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      // List 3 has content_types: ['bookmark', 'note'] so it shows the menu trigger
      renderAtRoute('/app/content/lists/3')

      await waitFor(() => {
        expect(screen.getByTestId('quick-add-menu-trigger')).toBeInTheDocument()
      })
    })

    it('shows single add button in bookmark-only list view', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      // List 1 has content_types: ['bookmark'] so it shows single add button
      renderAtRoute('/app/content/lists/1')

      await waitFor(() => {
        expect(screen.getByTestId('quick-add-single')).toBeInTheDocument()
      })
    })
  })

  describe('URL action parameter', () => {
    it('opens add modal when ?action=add is in URL', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content?action=add')

      await waitFor(() => {
        // Modal should be open - look for the form elements
        expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument()
      })
    })

    it('prepopulates tags for list view when ?action=add is in URL', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content/lists/1?action=add')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument()
      })

      expect(screen.getByText('list-tag-1')).toBeInTheDocument()
      expect(screen.getByText('list-tag-2')).toBeInTheDocument()
    })

    it('does not prepopulate list tags for all content', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content?action=add')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument()
      })

      expect(screen.queryByText('list-tag-1')).not.toBeInTheDocument()
      expect(screen.queryByText('list-tag-2')).not.toBeInTheDocument()
    })
  })

  describe('content type rendering', () => {
    it('renders BookmarkCard for bookmark items', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
      })
      // Bookmark should have URL displayed
      expect(screen.getByText('example.com')).toBeInTheDocument()
    })

    it('renders NoteCard for note items', async () => {
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Note')).toBeInTheDocument()
      })
    })

    it('renders mixed content correctly', async () => {
      mockContentQueryData = createMockResponse([mockBookmark, mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
        expect(screen.getByText('Test Note')).toBeInTheDocument()
      })
    })
  })

  describe('view-specific action buttons', () => {
    describe('active view', () => {
      it('shows Archive button for bookmarks', async () => {
        mockContentQueryData = createMockResponse([mockBookmark])
        renderAtRoute('/app/content')

        await waitFor(() => {
          expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
        })

        // Archive button should be present
        expect(screen.getByLabelText('Archive bookmark')).toBeInTheDocument()
      })

      it('shows Archive button for notes', async () => {
        mockContentQueryData = createMockResponse([mockNote])
        renderAtRoute('/app/content')

        await waitFor(() => {
          expect(screen.getByText('Test Note')).toBeInTheDocument()
        })

        expect(screen.getByLabelText('Archive note')).toBeInTheDocument()
      })
    })

    describe('archived view', () => {
      it('shows Restore/Unarchive button for bookmarks', async () => {
        mockContentQueryData = createMockResponse([mockArchivedBookmark])
        renderAtRoute('/app/content/archived')

        await waitFor(() => {
          expect(screen.getByText('Archived Bookmark')).toBeInTheDocument()
        })

        // In archived view, the button says "Restore" (for unarchive action)
        expect(screen.getByLabelText('Restore bookmark')).toBeInTheDocument()
      })
    })

    describe('deleted view', () => {
      it('shows Restore button for notes', async () => {
        mockContentQueryData = createMockResponse([mockDeletedNote])
        renderAtRoute('/app/content/trash')

        await waitFor(() => {
          expect(screen.getByText('Deleted Note')).toBeInTheDocument()
        })

        expect(screen.getByLabelText('Restore note')).toBeInTheDocument()
      })

      it('disables card click-to-edit in deleted view', async () => {
        mockContentQueryData = createMockResponse([mockDeletedNote])
        const { container } = renderAtRoute('/app/content/trash')

        await waitFor(() => {
          expect(screen.getByText('Deleted Note')).toBeInTheDocument()
        })

        // Card should not have cursor-pointer class in deleted view
        const card = container.querySelector('.card')
        expect(card).not.toHaveClass('cursor-pointer')
      })
    })
  })

  describe('note navigation with return state', () => {
    it('navigates to note view with returnTo state when clicking note', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Note')).toBeInTheDocument()
      })

      // Click on the note title/card to view it
      await user.click(screen.getByText('Test Note'))

      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/notes/2',
        expect.objectContaining({
          state: expect.objectContaining({
            returnTo: '/app/content',
          }),
        })
      )
    })

    it('navigates to note edit with returnTo state when clicking card', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockNote])
      const { container } = renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Note')).toBeInTheDocument()
      })

      // Click on the note card (not the title) to trigger edit
      const noteCard = container.querySelector('.card')
      await user.click(noteCard!)

      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/notes/2/edit',
        expect.objectContaining({
          state: expect.objectContaining({
            returnTo: '/app/content',
          }),
        })
      )
    })

    it('includes search params in returnTo state', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content?q=test')

      await waitFor(() => {
        expect(screen.getByText('Test Note')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Test Note'))

      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/notes/2',
        expect.objectContaining({
          state: expect.objectContaining({
            returnTo: '/app/content?q=test',
          }),
        })
      )
    })
  })

  describe('pagination', () => {
    it('shows pagination controls when there are multiple pages', async () => {
      const manyItems = Array.from({ length: 20 }, (_, i) => ({
        ...mockBookmark,
        id: i + 1,
        title: `Bookmark ${i + 1}`,
      }))
      mockContentQueryData = {
        items: manyItems,
        total: 25,
        offset: 0,
        limit: 20,
        has_more: true,
      }
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Bookmark 1')).toBeInTheDocument()
      })

      // Should show page indicator and navigation buttons
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
      expect(screen.getByText('Previous')).toBeInTheDocument()
      expect(screen.getByText('Next')).toBeInTheDocument()
    })

    it('shows page 1 of N pages', async () => {
      mockContentQueryData = {
        items: [mockBookmark],
        total: 40,
        offset: 0,
        limit: 20,
        has_more: true,
      }
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
      })

      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    })
  })

  describe('tag filtering', () => {
    it('calls addTag when clicking a tag on a card', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
      })

      // Click on a tag
      const tagButton = screen.getByRole('button', { name: 'test' })
      await user.click(tagButton)

      expect(mockAddTag).toHaveBeenCalledWith('test')
    })

    it('shows selected tags display when tags are selected', async () => {
      mockSelectedTags = ['test', 'example']
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Should show the selected tags section (label is "Filtering by:")
        expect(screen.getByText('Filtering by:')).toBeInTheDocument()
      })
    })

    it('calls removeTag when clicking a selected tag badge', async () => {
      const user = userEvent.setup()
      mockSelectedTags = ['test']
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Filtering by:')).toBeInTheDocument()
      })

      // The tag badge is a button that includes the tag name and a close icon
      // Find the button that contains the 'test' text in the filter area
      const filterSection = screen.getByText('Filtering by:').parentElement
      const tagButton = within(filterSection!).getByRole('button', { name: /test/ })
      await user.click(tagButton)

      expect(mockRemoveTag).toHaveBeenCalledWith('test')
    })

    it('calls clearFilters when clicking clear button', async () => {
      const user = userEvent.setup()
      mockSelectedTags = ['test', 'example']
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Filtering by:')).toBeInTheDocument()
      })

      // Clear button only shows with multiple tags, and text is just "Clear"
      const clearButton = screen.getByText('Clear')
      await user.click(clearButton)

      expect(mockClearTagFilters).toHaveBeenCalled()
    })
  })

  describe('content type filter', () => {
    it('shows content type filter chips in builtin views', async () => {
      mockContentQueryData = createMockResponse([mockBookmark, mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
      })

      // Should show filter chips
      expect(screen.getByRole('button', { name: /bookmarks/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /notes/i })).toBeInTheDocument()
    })

    it('calls toggleType when clicking content type chip', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockBookmark, mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
      })

      // Click the bookmarks chip to toggle it
      const bookmarksChip = screen.getByRole('button', { name: /bookmarks/i })
      await user.click(bookmarksChip)

      expect(mockToggleType).toHaveBeenCalledWith(
        'active',
        'bookmark',
        ['bookmark', 'note', 'prompt']
      )
    })
  })

  describe('loading state', () => {
    it('shows loading spinner while content is loading', async () => {
      mockContentQueryLoading = true
      renderAtRoute('/app/content')

      expect(screen.getByText('Loading content...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('shows error message when query fails', async () => {
      mockContentQueryError = new Error('Network error')
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('shows try again button on error', async () => {
      mockContentQueryError = new Error('Network error')
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
      })
    })

    it('calls refetch when try again is clicked', async () => {
      const user = userEvent.setup()
      mockContentQueryError = new Error('Network error')
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /try again/i }))

      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('bookmark actions', () => {
    it('calls archiveBookmark mutation when archive is clicked', async () => {
      const user = userEvent.setup()
      mockArchiveBookmark.mockResolvedValue(mockArchivedBookmark)
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Bookmark')).toBeInTheDocument()
      })

      const archiveButton = screen.getByLabelText('Archive bookmark')
      await user.click(archiveButton)

      expect(mockArchiveBookmark).toHaveBeenCalledWith(1)
    })

    it('calls unarchiveBookmark mutation when unarchive is clicked', async () => {
      const user = userEvent.setup()
      mockUnarchiveBookmark.mockResolvedValue(mockBookmark)
      mockContentQueryData = createMockResponse([mockArchivedBookmark])
      renderAtRoute('/app/content/archived')

      await waitFor(() => {
        expect(screen.getByText('Archived Bookmark')).toBeInTheDocument()
      })

      // In archived view, the button label is "Restore bookmark"
      const restoreButton = screen.getByLabelText('Restore bookmark')
      await user.click(restoreButton)

      expect(mockUnarchiveBookmark).toHaveBeenCalledWith(3)
    })
  })

  describe('note actions', () => {
    it('calls archiveNote mutation when archive is clicked', async () => {
      const user = userEvent.setup()
      mockArchiveNote.mockResolvedValue({ ...mockNote, archived_at: '2024-01-05T00:00:00Z' })
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        expect(screen.getByText('Test Note')).toBeInTheDocument()
      })

      const archiveButton = screen.getByLabelText('Archive note')
      await user.click(archiveButton)

      expect(mockArchiveNote).toHaveBeenCalledWith(2)
    })

    it('calls restoreNote mutation when restore is clicked in trash', async () => {
      const user = userEvent.setup()
      mockRestoreNote.mockResolvedValue(mockNote)
      mockContentQueryData = createMockResponse([mockDeletedNote])
      renderAtRoute('/app/content/trash')

      await waitFor(() => {
        expect(screen.getByText('Deleted Note')).toBeInTheDocument()
      })

      const restoreButton = screen.getByLabelText('Restore note')
      await user.click(restoreButton)

      expect(mockRestoreNote).toHaveBeenCalledWith(4)
    })
  })
})
