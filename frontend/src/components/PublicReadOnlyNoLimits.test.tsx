/**
 * Regression test for the public read view of a LOGGED-OUT visitor.
 *
 * `useLimits` only fetches when authenticated, so a logged-out visitor gets
 * `limits: undefined`. The reused detail components block rendering until limits
 * are present — which previously spun forever on the public page. In readOnly
 * mode they must fall back to PUBLIC_VIEW_LIMITS and render the content.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter } from '../test-utils'
import { Note } from './Note'
import type { Note as NoteType } from '../types'

// Simulate the logged-out case: no limits returned, query not loading. Keep the
// real PUBLIC_VIEW_LIMITS export so the component's fallback works.
vi.mock('../hooks/useLimits', async (importActual) => {
  const actual = await importActual<typeof import('../hooks/useLimits')>()
  return { ...actual, useLimits: () => ({ limits: undefined, isLoading: false, error: null }) }
})

vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({ value }: { value: string }) => (
    <textarea data-testid="content-editor" value={value} onChange={() => {}} />
  ),
}))
vi.mock('./MilkdownEditor', () => ({
  MilkdownEditor: ({ value }: { value: string }) => <div>{value}</div>,
}))

const note: NoteType = {
  id: 'n1', title: 'Public Note', description: null, tags: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  last_used_at: '2026-01-01T00:00:00Z', deleted_at: null, archived_at: null,
  content_preview: null, content: 'Body text',
}

describe('readOnly render with no limits (logged-out visitor)', () => {
  it('renders content instead of spinning forever', () => {
    renderWithRouter(
      <Note note={note} tagSuggestions={[]} onSave={vi.fn()} onClose={vi.fn()} readOnly
        viewState="active" aiAvailable={false} showTocToggle={false} />
    )
    expect(screen.getByText('Public Note')).toBeInTheDocument()
    expect(screen.getByTestId('content-editor')).toHaveValue('Body text')
    expect(screen.queryByText('Loading note...')).toBeNull()
  })
})
