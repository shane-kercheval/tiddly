/**
 * Tests for AddRelationshipModal component.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AddRelationshipModal } from './AddRelationshipModal'
import { api } from '../services/api'
import type { ContentListItem, ContentListResponse, RelationshipWithContent, RelationshipListResponse } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = api.get as Mock
const mockPost = api.post as Mock

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function makeContentItem(overrides: Partial<ContentListItem> = {}): ContentListItem {
  return {
    type: 'note',
    id: 'note-1',
    title: 'Test Note',
    description: 'A test note',
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    last_used_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    archived_at: null,
    content_preview: null,
    url: null,
    version: 1,
    name: null,
    arguments: null,
    ...overrides,
  }
}

function makeSearchResponse(items: ContentListItem[]): ContentListResponse {
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 20,
    has_more: false,
  }
}

function makeRelationship(overrides: Partial<RelationshipWithContent> = {}): RelationshipWithContent {
  return {
    id: 'rel-1',
    source_type: 'bookmark',
    source_id: 'bm-1',
    target_type: 'note',
    target_id: 'note-1',
    relationship_type: 'related',
    description: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    source_title: 'My Bookmark',
    source_url: 'https://example.com',
    target_title: 'My Note',
    target_url: null,
    source_deleted: false,
    target_deleted: false,
    source_archived: false,
    target_archived: false,
    ...overrides,
  }
}

function makeRelationshipListResponse(items: RelationshipWithContent[]): RelationshipListResponse {
  return { items, total: items.length, offset: 0, limit: 50, has_more: false }
}

/** Set up mockGet to handle both relationships and content search endpoints */
function setupMockGet(
  searchItems: ContentListItem[],
  existingRelationships: RelationshipWithContent[] = [],
): void {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/relationships/content/')) {
      return Promise.resolve({ data: makeRelationshipListResponse(existingRelationships) })
    }
    return Promise.resolve({ data: makeSearchResponse(searchItems) })
  })
}

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  sourceType: 'bookmark' as const,
  sourceId: 'bm-1',
}

describe('AddRelationshipModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no existing relationships, no search results
    setupMockGet([])
  })

  it('should render modal with search input when open', () => {
    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search bookmarks, notes, prompts...')).toBeInTheDocument()
  })

  it('should not render when closed', () => {
    render(
      <AddRelationshipModal {...defaultProps} isOpen={false} />,
      { wrapper: createWrapper() },
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should search and display results after typing', async () => {
    const user = userEvent.setup()
    const items = [
      makeContentItem({ id: 'note-1', title: 'My Note' }),
      makeContentItem({ type: 'prompt', id: 'prompt-1', title: 'My Prompt', name: 'my-prompt' }),
    ]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    expect(await screen.findByText('My Note')).toBeInTheDocument()
    expect(screen.getByText('My Prompt')).toBeInTheDocument()
  })

  it('should filter out current item from results', async () => {
    const user = userEvent.setup()
    const items = [
      makeContentItem({ type: 'bookmark', id: 'bm-1', title: 'Self Bookmark' }),
      makeContentItem({ id: 'note-1', title: 'Other Note' }),
    ]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} sourceType="bookmark" sourceId="bm-1" />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    expect(await screen.findByText('Other Note')).toBeInTheDocument()
    expect(screen.queryByText('Self Bookmark')).not.toBeInTheDocument()
  })

  it('should filter out already-linked items from results', async () => {
    const user = userEvent.setup()
    const searchItems = [
      makeContentItem({ id: 'note-1', title: 'Already Linked' }),
      makeContentItem({ id: 'note-2', title: 'Not Linked' }),
    ]
    // note-1 is already linked via an existing relationship
    const existingRels = [
      makeRelationship({ target_id: 'note-1', target_title: 'Already Linked' }),
    ]
    setupMockGet(searchItems, existingRels)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    expect(await screen.findByText('Not Linked')).toBeInTheDocument()
    expect(screen.queryByText('Already Linked')).not.toBeInTheDocument()
  })

  it('should not filter items with same id but different type as already-linked', async () => {
    const user = userEvent.setup()
    // A bookmark with id 'shared-id' is already linked, but a note with 'shared-id' should still show
    const searchItems = [
      makeContentItem({ type: 'note', id: 'shared-id', title: 'Note Same ID' }),
    ]
    const existingRels = [
      makeRelationship({ target_type: 'bookmark', target_id: 'shared-id', target_title: 'Bookmark Same ID' }),
    ]
    setupMockGet(searchItems, existingRels)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    expect(await screen.findByText('Note Same ID')).toBeInTheDocument()
  })

  it('should highlight selected item', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    const option = await screen.findByRole('option')
    await user.click(option)

    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  it('should show selected item indicator after selection', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')
    await user.click(await screen.findByRole('option'))

    // Selected indicator shows the title in a highlighted box
    const indicators = screen.getAllByText('My Note')
    // One in search results, one in selected indicator
    expect(indicators.length).toBeGreaterThanOrEqual(2)
  })

  it('should capture description input', async () => {
    const user = userEvent.setup()
    setupMockGet([])

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    // Wait for Modal's requestAnimationFrame focus management to complete
    await new Promise((r) => setTimeout(r, 50))

    const textarea = screen.getByPlaceholderText('Why are these linked? (optional)')
    await user.click(textarea)
    await user.type(textarea, 'Related context')

    expect(textarea).toHaveValue('Related context')
  })

  it('should disable Link button when no item selected', () => {
    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled()
  })

  it('should enable Link button when item selected', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')
    await user.click(await screen.findByRole('option'))

    expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled()
  })

  it('should create relationship and close on submit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)
    mockPost.mockResolvedValueOnce({ data: { id: 'rel-1' } })

    render(
      <AddRelationshipModal
        {...defaultProps}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')
    await user.click(await screen.findByRole('option'))
    await user.type(
      screen.getByPlaceholderText('Why are these linked? (optional)'),
      'Related context',
    )
    await user.click(screen.getByRole('button', { name: 'Link' }))

    expect(mockPost).toHaveBeenCalledWith('/relationships/', {
      source_type: 'bookmark',
      source_id: 'bm-1',
      target_type: 'note',
      target_id: 'note-1',
      relationship_type: 'related',
      description: 'Related context',
    })
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('should send null description when empty', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)
    mockPost.mockResolvedValueOnce({ data: { id: 'rel-1' } })

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')
    await user.click(await screen.findByRole('option'))
    await user.click(screen.getByRole('button', { name: 'Link' }))

    expect(mockPost).toHaveBeenCalledWith('/relationships/', expect.objectContaining({
      description: null,
    }))
  })

  it('should show error message when submit fails', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)
    mockPost.mockRejectedValueOnce(new Error('Network error'))

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')
    await user.click(await screen.findByRole('option'))
    await user.click(screen.getByRole('button', { name: 'Link' }))

    expect(await screen.findByText('Failed to create link. Please try again.')).toBeInTheDocument()
  })

  it('should show "No results found" when search returns empty', async () => {
    const user = userEvent.setup()
    setupMockGet([])

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'xyz')

    expect(await screen.findByText('No results found.')).toBeInTheDocument()
  })

  it('should show item description in search results', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note', description: 'Some description' })]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    expect(await screen.findByText('Some description')).toBeInTheDocument()
  })

  it('should render "Untitled" for items with null title', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: null })]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'test')

    expect(await screen.findByText('Untitled')).toBeInTheDocument()
  })

  it('should clear selection when search query changes', async () => {
    const user = userEvent.setup()
    const items = [makeContentItem({ id: 'note-1', title: 'My Note' })]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    const input = screen.getByPlaceholderText('Search bookmarks, notes, prompts...')
    await user.type(input, 'test')
    await user.click(await screen.findByRole('option'))

    // Link button should be enabled after selection
    expect(screen.getByRole('button', { name: 'Link' })).toBeEnabled()

    // Type more to change query — selection should clear
    await user.type(input, 'x')
    expect(screen.getByRole('button', { name: 'Link' })).toBeDisabled()
  })

  it('should render results as a listbox with options', async () => {
    const user = userEvent.setup()
    const items = [
      makeContentItem({ id: 'note-1', title: 'Note A' }),
      makeContentItem({ id: 'note-2', title: 'Note B' }),
    ]
    setupMockGet(items)

    render(
      <AddRelationshipModal {...defaultProps} />,
      { wrapper: createWrapper() },
    )

    await user.type(screen.getByPlaceholderText('Search bookmarks, notes, prompts...'), 'note')

    const listbox = await screen.findByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(2)
  })

  it('should call onClose when Cancel clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <AddRelationshipModal {...defaultProps} onClose={onClose} />,
      { wrapper: createWrapper() },
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
