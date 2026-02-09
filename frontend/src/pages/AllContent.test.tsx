/**
 * Tests for AllContent page.
 *
 * Covers:
 * - View-specific empty states
 * - QuickAddMenu visibility
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
  id: '1',
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
  content_preview: null,
}

const mockNote: ContentListItem = {
  type: 'note',
  id: '2',
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
  content_preview: null,
}

const mockArchivedBookmark: ContentListItem = {
  ...mockBookmark,
  id: '3',
  title: 'Archived Bookmark',
  archived_at: '2024-01-05T00:00:00Z',
}

const mockDeletedNote: ContentListItem = {
  ...mockNote,
  id: '4',
  title: 'Deleted Note',
  deleted_at: '2024-01-06T00:00:00Z',
}

const mockPrompt: ContentListItem = {
  type: 'prompt',
  id: '5',
  title: 'Test Prompt',
  description: 'A test prompt description',
  tags: ['test', 'prompt'],
  url: null,
  version: null,
  name: 'test-prompt',
  arguments: [{ name: 'input', description: 'Input text', required: true }],
  created_at: '2024-01-03T00:00:00Z',
  updated_at: '2024-01-03T00:00:00Z',
  last_used_at: '2024-01-03T00:00:00Z',
  deleted_at: null,
  archived_at: null,
  content_preview: null,
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
    trackBookmarkUsage: vi.fn(),
  }),
}))

const mockDeleteBookmark = vi.fn()
const mockRestoreBookmark = vi.fn()
const mockArchiveBookmark = vi.fn()
const mockUnarchiveBookmark = vi.fn()
const mockUpdateBookmark = vi.fn()

vi.mock('../hooks/useBookmarkMutations', () => ({
  useDeleteBookmark: () => ({ mutateAsync: mockDeleteBookmark, isPending: false }),
  useRestoreBookmark: () => ({ mutateAsync: mockRestoreBookmark, isPending: false }),
  useArchiveBookmark: () => ({ mutateAsync: mockArchiveBookmark, isPending: false }),
  useUnarchiveBookmark: () => ({ mutateAsync: mockUnarchiveBookmark, isPending: false }),
  useUpdateBookmark: () => ({ mutateAsync: mockUpdateBookmark, isPending: false }),
}))

const mockDeleteNote = vi.fn()
const mockRestoreNote = vi.fn()
const mockArchiveNote = vi.fn()
const mockUnarchiveNote = vi.fn()
const mockUpdateNote = vi.fn()

vi.mock('../hooks/useNoteMutations', () => ({
  useCreateNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateNote: () => ({ mutateAsync: mockUpdateNote, isPending: false }),
  useDeleteNote: () => ({ mutateAsync: mockDeleteNote, isPending: false }),
  useRestoreNote: () => ({ mutateAsync: mockRestoreNote, isPending: false }),
  useArchiveNote: () => ({ mutateAsync: mockArchiveNote, isPending: false }),
  useUnarchiveNote: () => ({ mutateAsync: mockUnarchiveNote, isPending: false }),
}))

const mockDeletePrompt = vi.fn()
const mockRestorePrompt = vi.fn()
const mockArchivePrompt = vi.fn()
const mockUnarchivePrompt = vi.fn()
const mockUpdatePrompt = vi.fn()

vi.mock('../hooks/usePromptMutations', () => ({
  useCreatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePrompt: () => ({ mutateAsync: mockUpdatePrompt, isPending: false }),
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
  getViewKey: (view: string, filterId?: string) => filterId ? `filter-${filterId}` : view,
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: () => ({
    tags: [
      { name: 'test', content_count: 5, filter_count: 0 },
      { name: 'example', content_count: 3, filter_count: 0 },
    ],
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

vi.mock('../stores/filtersStore', () => ({
  useFiltersStore: () => ({
    filters: [
      {
        id: '1',
        name: 'Reading List',
        content_types: ['bookmark'],
        filter_expression: { groups: [{ tags: ['filter-tag-1', 'filter-tag-2'], operator: 'AND' }], group_operator: 'OR' },
        default_sort_by: null,
        default_sort_ascending: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: '2',
        name: 'Ideas',
        content_types: ['note'],
        filter_expression: { groups: [], group_operator: 'OR' },
        default_sort_by: null,
        default_sort_ascending: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: '3',
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
        <Route path="/app/content/filters/:filterId" element={<AllContent />} />
        <Route path="/app/notes/:id" element={<div data-testid="note-detail">Note Detail</div>} />
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

    it('shows bookmark-only empty state in custom filter view', async () => {
      mockContentQueryData = createMockResponse([])
      renderAtRoute('/app/content/filters/1')

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

    it('shows QuickAddMenu in custom filter view with mixed content types', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      // Filter 3 has content_types: ['bookmark', 'note'] so it shows the menu trigger
      renderAtRoute('/app/content/filters/3')

      await waitFor(() => {
        expect(screen.getByTestId('quick-add-menu-trigger')).toBeInTheDocument()
      })
    })

    it('shows single add button in bookmark-only filter view', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      // Filter 1 has content_types: ['bookmark'] so it shows single add button
      renderAtRoute('/app/content/filters/1')

      await waitFor(() => {
        expect(screen.getByTestId('quick-add-single')).toBeInTheDocument()
      })
    })
  })

  describe('content type rendering', () => {
    it('renders BookmarkCard for bookmark items', async () => {
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
      })
      // Bookmark should have URL displayed (full URL without query params)
      const urls = screen.getAllByText('https://example.com')
      expect(urls.length).toBeGreaterThan(0)
    })

    it('renders NoteCard for note items', async () => {
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })
    })

    it('renders mixed content correctly', async () => {
      mockContentQueryData = createMockResponse([mockBookmark, mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Titles appear in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })
    })
  })

  describe('view-specific action buttons', () => {
    describe('active view', () => {
      it('shows Archive button for bookmarks', async () => {
        mockContentQueryData = createMockResponse([mockBookmark])
        renderAtRoute('/app/content')

        await waitFor(() => {
          // Title appears in both mobile and desktop layouts
          expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
        })

        // Archive button appears in both layouts
        expect(screen.getAllByLabelText('Archive bookmark').length).toBeGreaterThan(0)
      })

      it('shows Archive button for notes', async () => {
        mockContentQueryData = createMockResponse([mockNote])
        renderAtRoute('/app/content')

        await waitFor(() => {
          // Title appears in both mobile and desktop layouts
          expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
        })

        // Archive button appears in both layouts
        expect(screen.getAllByLabelText('Archive note').length).toBeGreaterThan(0)
      })
    })

    describe('archived view', () => {
      it('shows Restore/Unarchive button for bookmarks', async () => {
        mockContentQueryData = createMockResponse([mockArchivedBookmark])
        renderAtRoute('/app/content/archived')

        await waitFor(() => {
          // Title appears in both mobile and desktop layouts
          expect(screen.getAllByText('Archived Bookmark').length).toBeGreaterThan(0)
        })

        // In archived view, the button says "Restore" (for unarchive action)
        expect(screen.getAllByLabelText('Restore bookmark').length).toBeGreaterThan(0)
      })
    })

    describe('deleted view', () => {
      it('shows Restore button for notes', async () => {
        mockContentQueryData = createMockResponse([mockDeletedNote])
        renderAtRoute('/app/content/trash')

        await waitFor(() => {
          // Title appears in both mobile and desktop layouts
          expect(screen.getAllByText('Deleted Note').length).toBeGreaterThan(0)
        })

        // Restore button appears in both layouts
        expect(screen.getAllByLabelText('Restore note').length).toBeGreaterThan(0)
      })

      it('allows card click to view in deleted view', async () => {
        const user = userEvent.setup()
        mockContentQueryData = createMockResponse([mockDeletedNote])
        const { container } = renderAtRoute('/app/content/trash')

        await waitFor(() => {
          // Title appears in both mobile and desktop layouts
          expect(screen.getAllByText('Deleted Note').length).toBeGreaterThan(0)
        })

        // Card should have cursor-pointer class - deleted items are still viewable
        const card = container.querySelector('.card')
        expect(card).toHaveClass('cursor-pointer')

        // Clicking should navigate to view mode (not edit)
        await user.click(card!)
        expect(mockNavigate).toHaveBeenCalledWith(
          '/app/notes/4',
          expect.objectContaining({
            state: expect.objectContaining({
              returnTo: '/app/content/trash',
            }),
          })
        )
      })
    })
  })

  describe('note navigation with return state', () => {
    it('navigates to note view with returnTo state when clicking note', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })

      // Click on the note title/card to view it (click first match)
      await user.click(screen.getAllByText('Test Note')[0])

      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/notes/2',
        expect.objectContaining({
          state: expect.objectContaining({
            returnTo: '/app/content',
          }),
        })
      )
    })

    it('navigates to note view with returnTo state when clicking card', async () => {
      const user = userEvent.setup()
      mockContentQueryData = createMockResponse([mockNote])
      const { container } = renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })

      // Click on the note card to view it (card click now goes to view, not edit)
      const noteCard = container.querySelector('.card')
      await user.click(noteCard!)

      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/notes/2',
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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })

      // Click first match
      await user.click(screen.getAllByText('Test Note')[0])

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
        id: String(i + 1),
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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Bookmark 1').length).toBeGreaterThan(0)
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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
      })

      // Click on a tag (appears in both layouts, click first)
      const tagButtons = screen.getAllByRole('button', { name: 'test' })
      await user.click(tagButtons[0])

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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
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
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
      })

      // Archive button appears in both layouts, click first
      const archiveButtons = screen.getAllByLabelText('Archive bookmark')
      await user.click(archiveButtons[0])

      expect(mockArchiveBookmark).toHaveBeenCalledWith('1')
    })

    it('calls unarchiveBookmark mutation when unarchive is clicked', async () => {
      const user = userEvent.setup()
      mockUnarchiveBookmark.mockResolvedValue(mockBookmark)
      mockContentQueryData = createMockResponse([mockArchivedBookmark])
      renderAtRoute('/app/content/archived')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Archived Bookmark').length).toBeGreaterThan(0)
      })

      // In archived view, the button label is "Restore bookmark" (appears in both layouts)
      const restoreButtons = screen.getAllByLabelText('Restore bookmark')
      await user.click(restoreButtons[0])

      expect(mockUnarchiveBookmark).toHaveBeenCalledWith('3')
    })
  })

  describe('note actions', () => {
    it('calls archiveNote mutation when archive is clicked', async () => {
      const user = userEvent.setup()
      mockArchiveNote.mockResolvedValue({ ...mockNote, archived_at: '2024-01-05T00:00:00Z' })
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })

      // Archive button appears in both layouts, click first
      const archiveButtons = screen.getAllByLabelText('Archive note')
      await user.click(archiveButtons[0])

      expect(mockArchiveNote).toHaveBeenCalledWith('2')
    })

    it('calls restoreNote mutation when restore is clicked in trash', async () => {
      const user = userEvent.setup()
      mockRestoreNote.mockResolvedValue(mockNote)
      mockContentQueryData = createMockResponse([mockDeletedNote])
      renderAtRoute('/app/content/trash')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Deleted Note').length).toBeGreaterThan(0)
      })

      // Restore button appears in both layouts, click first
      const restoreButtons = screen.getAllByLabelText('Restore note')
      await user.click(restoreButtons[0])

      expect(mockRestoreNote).toHaveBeenCalledWith('4')
    })
  })

  describe('tag addition', () => {
    it('calls updateBookmark mutation with correct tags when adding tag to bookmark', async () => {
      const user = userEvent.setup()
      mockUpdateBookmark.mockResolvedValue({ ...mockBookmark, tags: ['test', 'bookmark', 'example'] })
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
      })

      // Click add tag button to open dropdown (appears in both layouts, click first)
      const addTagButtons = screen.getAllByRole('button', { name: 'Add tag' })
      await user.click(addTagButtons[0])

      // Wait for dropdown to open (input appears)
      await screen.findByPlaceholderText('Add tag...')

      // Wait for and click the 'example' suggestion button (it's in tagsStore but not on this bookmark)
      const suggestionButton = await screen.findByRole('button', { name: /^example/ })
      await user.click(suggestionButton)

      expect(mockUpdateBookmark).toHaveBeenCalledWith({
        id: '1',
        data: { tags: ['test', 'bookmark', 'example'] },
      })
    })

    it('calls updateNote mutation with correct tags when adding tag to note', async () => {
      const user = userEvent.setup()
      mockUpdateNote.mockResolvedValue({ ...mockNote, tags: ['test', 'note', 'example'] })
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })

      // Click add tag button to open dropdown (appears in both layouts, click first)
      const addTagButtons = screen.getAllByRole('button', { name: 'Add tag' })
      await user.click(addTagButtons[0])

      // Wait for dropdown to open (input appears)
      await screen.findByPlaceholderText('Add tag...')

      // Wait for and click the 'example' suggestion button
      const suggestionButton = await screen.findByRole('button', { name: /^example/ })
      await user.click(suggestionButton)

      expect(mockUpdateNote).toHaveBeenCalledWith({
        id: '2',
        data: { tags: ['test', 'note', 'example'] },
      })
    })

    it('calls updatePrompt mutation with correct tags when adding tag to prompt', async () => {
      const user = userEvent.setup()
      mockUpdatePrompt.mockResolvedValue({ ...mockPrompt, tags: ['test', 'prompt', 'example'] })
      mockContentQueryData = createMockResponse([mockPrompt])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Prompt').length).toBeGreaterThan(0)
      })

      // Click add tag button to open dropdown (appears in both layouts, click first)
      const addTagButtons = screen.getAllByRole('button', { name: 'Add tag' })
      await user.click(addTagButtons[0])

      // Wait for dropdown to open (input appears)
      await screen.findByPlaceholderText('Add tag...')

      // Wait for and click the 'example' suggestion button
      const suggestionButton = await screen.findByRole('button', { name: /^example/ })
      await user.click(suggestionButton)

      expect(mockUpdatePrompt).toHaveBeenCalledWith({
        id: '5',
        data: { tags: ['test', 'prompt', 'example'] },
      })
    })

    it('does not show add tag button in deleted view', async () => {
      mockContentQueryData = createMockResponse([mockDeletedNote])
      renderAtRoute('/app/content/trash')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Deleted Note').length).toBeGreaterThan(0)
      })

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })
  })

  describe('tag removal', () => {
    it('calls updateBookmark mutation with correct tags when removing tag from bookmark', async () => {
      const user = userEvent.setup()
      mockUpdateBookmark.mockResolvedValue({ ...mockBookmark, tags: ['bookmark'] })
      mockContentQueryData = createMockResponse([mockBookmark])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Bookmark').length).toBeGreaterThan(0)
      })

      // Click remove button on 'test' tag (appears in both layouts, click first)
      const removeButtons = screen.getAllByRole('button', { name: /remove tag test/i })
      await user.click(removeButtons[0])

      expect(mockUpdateBookmark).toHaveBeenCalledWith({
        id: '1',
        data: { tags: ['bookmark'] },
      })
    })

    it('calls updateNote mutation with correct tags when removing tag from note', async () => {
      const user = userEvent.setup()
      mockUpdateNote.mockResolvedValue({ ...mockNote, tags: ['note'] })
      mockContentQueryData = createMockResponse([mockNote])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Note').length).toBeGreaterThan(0)
      })

      // Click remove button on 'test' tag (appears in both layouts, click first)
      const removeButtons = screen.getAllByRole('button', { name: /remove tag test/i })
      await user.click(removeButtons[0])

      expect(mockUpdateNote).toHaveBeenCalledWith({
        id: '2',
        data: { tags: ['note'] },
      })
    })

    it('calls updatePrompt mutation with correct tags when removing tag from prompt', async () => {
      const user = userEvent.setup()
      mockUpdatePrompt.mockResolvedValue({ ...mockPrompt, tags: ['prompt'] })
      mockContentQueryData = createMockResponse([mockPrompt])
      renderAtRoute('/app/content')

      await waitFor(() => {
        // Title appears in both mobile and desktop layouts
        expect(screen.getAllByText('Test Prompt').length).toBeGreaterThan(0)
      })

      // Click remove button on 'test' tag (appears in both layouts, click first)
      const removeButtons = screen.getAllByRole('button', { name: /remove tag test/i })
      await user.click(removeButtons[0])

      expect(mockUpdatePrompt).toHaveBeenCalledWith({
        id: '5',
        data: { tags: ['prompt'] },
      })
    })
  })
})
