/**
 * Tests for RelatedContent component and getLinkedItem utility.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RelatedContent } from './RelatedContent'
import { getLinkedItem } from '../utils/relationships'
import { api } from '../services/api'
import type { RelationshipWithContent, RelationshipListResponse } from '../types'

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = api.get as Mock
const mockDelete = api.delete as Mock

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

function makeListResponse(items: RelationshipWithContent[]): RelationshipListResponse {
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 50,
    has_more: false,
  }
}

// =============================================================================
// getLinkedItem unit tests
// =============================================================================

describe('getLinkedItem', () => {
  it('should return target info when self is source', () => {
    const rel = makeRelationship()
    const linked = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(linked.type).toBe('note')
    expect(linked.id).toBe('note-1')
    expect(linked.title).toBe('My Note')
    expect(linked.url).toBeNull()
    expect(linked.deleted).toBe(false)
    expect(linked.archived).toBe(false)
    expect(linked.relationshipId).toBe('rel-1')
  })

  it('should return source info when self is target', () => {
    const rel = makeRelationship()
    const linked = getLinkedItem(rel, 'note', 'note-1')

    expect(linked.type).toBe('bookmark')
    expect(linked.id).toBe('bm-1')
    expect(linked.title).toBe('My Bookmark')
    expect(linked.url).toBe('https://example.com')
  })

  it('should include relationship description', () => {
    const rel = makeRelationship({ description: 'Related context' })
    const linked = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(linked.description).toBe('Related context')
  })

  it('should propagate deleted flag from target', () => {
    const rel = makeRelationship({ target_deleted: true })
    const linked = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(linked.deleted).toBe(true)
  })

  it('should propagate archived flag from target', () => {
    const rel = makeRelationship({ target_archived: true })
    const linked = getLinkedItem(rel, 'bookmark', 'bm-1')

    expect(linked.archived).toBe(true)
  })

  it('should propagate deleted flag from source when self is target', () => {
    const rel = makeRelationship({ source_deleted: true })
    const linked = getLinkedItem(rel, 'note', 'note-1')

    expect(linked.deleted).toBe(true)
  })
})

// =============================================================================
// RelatedContent component tests
// =============================================================================

describe('RelatedContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render linked items with titles and icons', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship(),
        makeRelationship({
          id: 'rel-2',
          target_type: 'prompt',
          target_id: 'prompt-1',
          target_title: 'My Prompt',
        }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('My Note')).toBeInTheDocument()
    expect(screen.getByText('My Prompt')).toBeInTheDocument()
  })

  it('should render "Untitled" for items with null title', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ target_title: null }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('Untitled')).toBeInTheDocument()
  })

  it('should render empty state when no relationships', async () => {
    mockGet.mockResolvedValueOnce({ data: makeListResponse([]) })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('No linked content yet.')).toBeInTheDocument()
  })

  it('should render loading state', () => {
    // Never resolve the mock to keep loading
    mockGet.mockReturnValue(new Promise(() => {}))

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should show deleted indicator', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ target_deleted: true }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('deleted')).toBeInTheDocument()
    // Title should have line-through class
    const title = screen.getByText('My Note')
    expect(title.className).toContain('line-through')
  })

  it('should show archived indicator', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ target_archived: true }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('archived')).toBeInTheDocument()
  })

  it('should not show archived when also deleted', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ target_deleted: true, target_archived: true }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('deleted')).toBeInTheDocument()
    expect(screen.queryByText('archived')).not.toBeInTheDocument()
  })

  it('should render relationship description', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ description: 'Background context' }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('Background context')).toBeInTheDocument()
  })

  it('should render + Link button when onAddClick provided', async () => {
    mockGet.mockResolvedValueOnce({ data: makeListResponse([]) })
    const onAddClick = vi.fn()

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" onAddClick={onAddClick} />,
      { wrapper: createWrapper() },
    )

    const button = await screen.findByLabelText('Link content')
    await userEvent.click(button)

    expect(onAddClick).toHaveBeenCalledOnce()
  })

  it('should not render + Link button when onAddClick not provided', async () => {
    mockGet.mockResolvedValueOnce({ data: makeListResponse([]) })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    await screen.findByText('No linked content yet.')
    expect(screen.queryByLabelText('Link content')).not.toBeInTheDocument()
  })

  it('should call onNavigate when item is clicked', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
    })
    const onNavigate = vi.fn()

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" onNavigate={onNavigate} />,
      { wrapper: createWrapper() },
    )

    await userEvent.click(await screen.findByText('My Note'))

    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'note',
        id: 'note-1',
        title: 'My Note',
      }),
    )
  })

  it('should call remove mutation when remove button clicked', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
    })
    mockDelete.mockResolvedValueOnce({})

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    const removeButton = await screen.findByLabelText('Remove link to My Note')
    await userEvent.click(removeButton)

    expect(mockDelete).toHaveBeenCalledWith('/relationships/rel-1')
  })

  it('should render header text', async () => {
    mockGet.mockResolvedValueOnce({ data: makeListResponse([]) })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('Linked Content')).toBeInTheDocument()
  })

  it('should resolve items correctly when self is target due to canonical ordering', async () => {
    // Canonical ordering stored bookmark as source, but we're viewing from the note
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
    })

    render(
      <RelatedContent contentType="note" contentId="note-1" />,
      { wrapper: createWrapper() },
    )

    // Should show the bookmark (the other side)
    expect(await screen.findByText('My Bookmark')).toBeInTheDocument()
  })

  it('should render error state when fetch fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'))

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    expect(await screen.findByText('Failed to load linked content.')).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
    // Should NOT show empty state
    expect(screen.queryByText('No linked content yet.')).not.toBeInTheDocument()
  })

  it('should render navigable items as buttons when onNavigate provided', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
    })
    const onNavigate = vi.fn()

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" onNavigate={onNavigate} />,
      { wrapper: createWrapper() },
    )

    const navButton = await screen.findByLabelText('Go to Note: My Note')
    expect(navButton.tagName).toBe('BUTTON')
  })

  it('should not render navigable buttons when onNavigate not provided', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([makeRelationship()]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    await screen.findByText('My Note')
    expect(screen.queryByLabelText('Go to Note: My Note')).not.toBeInTheDocument()
  })

  it('should render multiple items in a list', async () => {
    mockGet.mockResolvedValueOnce({
      data: makeListResponse([
        makeRelationship({ id: 'rel-1', target_title: 'Note A' }),
        makeRelationship({ id: 'rel-2', target_title: 'Note B' }),
        makeRelationship({ id: 'rel-3', target_title: 'Note C' }),
      ]),
    })

    render(
      <RelatedContent contentType="bookmark" contentId="bm-1" />,
      { wrapper: createWrapper() },
    )

    const list = await screen.findByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
  })
})
