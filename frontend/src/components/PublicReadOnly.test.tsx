/**
 * Tests for the `readOnly` (public share) mode of the reused detail render
 * components. readOnly must show the item's content while hiding ALL owner UI —
 * the toolbar (Close/Save/archive/delete/history), the tags/relationships rows,
 * and (for prompts) Preview. This is stricter than the deleted-item read-only
 * state, which still shows organizational metadata.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { renderWithRouter } from '../test-utils'
import { Note } from './Note'
import { Bookmark } from './Bookmark'
import { Prompt } from './Prompt'
import type { Bookmark as BookmarkType, Note as NoteType, Prompt as PromptType } from '../types'

// Editors are heavy (CodeMirror); stub them to a textarea that echoes content.
vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value, onChange, disabled }: {
    value: string
    onChange: (v: string) => void
    disabled?: boolean
  }) => (
    <textarea
      data-testid="content-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  ),
}))
vi.mock('./MilkdownEditor', () => ({
  MilkdownEditor: ({ value }: { value: string }) => <div data-testid="reading">{value}</div>,
}))

const TS = '2026-01-01T00:00:00Z'

const note: NoteType = {
  id: 'n1', title: 'My Note', description: 'A description', tags: ['keep-private'],
  created_at: TS, updated_at: TS, last_used_at: TS, deleted_at: null, archived_at: null,
  content_preview: null, content: 'Note body text',
}

const bookmark: BookmarkType = {
  id: 'b1', url: 'https://example.com', title: 'My Bookmark', description: 'A description',
  summary: null, tags: ['keep-private'], created_at: TS, updated_at: TS, last_used_at: TS,
  deleted_at: null, archived_at: null, content_preview: null, content: 'Bookmark body',
}

const prompt: PromptType = {
  id: 'p1', name: 'my-prompt', title: 'My Prompt', description: 'A description',
  arguments: [], tags: ['keep-private'], created_at: TS, updated_at: TS, last_used_at: TS,
  deleted_at: null, archived_at: null, content_preview: null, content: 'Hello {{ name }}',
}

describe('readOnly (public share) mode', () => {
  it('Note: shows content + dates, hides toolbar and organizational UI', () => {
    renderWithRouter(
      <Note note={note} tagSuggestions={[]} onSave={vi.fn()} onClose={vi.fn()} readOnly
        viewState="active" aiAvailable={false} showTocToggle={false} />
    )
    expect(screen.getByText('My Note')).toBeInTheDocument()
    expect(screen.getByTestId('content-editor')).toHaveValue('Note body text')
    expect(screen.getByText(/Created/)).toBeInTheDocument()
    // Owner UI is gone:
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(save|create)$/i })).toBeNull()
    expect(screen.queryByLabelText('Add tag')).toBeNull()
    expect(screen.queryByLabelText('Link content')).toBeNull()
    // The private tag value must not leak into the public view.
    expect(screen.queryByText('keep-private')).toBeNull()
  })

  it('Bookmark: shows url + title, hides toolbar and organizational UI', () => {
    renderWithRouter(
      <Bookmark bookmark={bookmark} tagSuggestions={[]} onSave={vi.fn()} onClose={vi.fn()} readOnly
        viewState="active" aiAvailable={false} />
    )
    expect(screen.getByRole('link', { name: 'https://example.com' })).toBeInTheDocument()
    expect(screen.getByText('My Bookmark')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    expect(screen.queryByLabelText('Add tag')).toBeNull()
    expect(screen.queryByText('keep-private')).toBeNull()
  })

  it('Prompt: shows name + template content, hides toolbar and Preview', () => {
    renderWithRouter(
      <Prompt prompt={prompt} tagSuggestions={[]} onSave={vi.fn()} onClose={vi.fn()} readOnly
        viewState="active" aiAvailable={false} showTocToggle={false} />
    )
    expect(screen.getByText('my-prompt')).toBeInTheDocument()
    expect(screen.getByTestId('content-editor')).toHaveValue('Hello {{ name }}')
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull()
    expect(screen.queryByLabelText('Add tag')).toBeNull()
    expect(screen.queryByText('keep-private')).toBeNull()
  })

  it('regression: a deleted item (not readOnly) still shows its tags + trash banner', () => {
    // Deleted (non-readOnly) still renders the relationships row, whose
    // LinkedContentChips uses react-query — so this case needs a QueryClient
    // (the public readOnly cases above don't, since that row is gated out).
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
    render(
      <Note note={{ ...note, deleted_at: TS }} tagSuggestions={[]} onSave={vi.fn()} onClose={vi.fn()}
        viewState="deleted" aiAvailable={false} showTocToggle={false} />,
      { wrapper }
    )
    // The deleted read-only state keeps organizational metadata + its banner.
    expect(screen.getByText('keep-private')).toBeInTheDocument()
    expect(screen.getByText(/in trash and cannot be edited/i)).toBeInTheDocument()
  })
})
