import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TipCard } from './TipCard'
import type { Tip } from '../../data/tips/types'

function renderCard(tip: Tip, variant: 'full' | 'compact'): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <TipCard tip={tip} variant={variant} />
    </MemoryRouter>,
  )
}

const baseTip: Tip = {
  id: 'fixture',
  title: 'Save a bookmark by pasting its URL',
  body: 'Copy a URL anywhere on the web, then press `⌘+V`.',
  category: 'bookmarks',
  audience: 'beginner',
}

describe('TipCard — full variant', () => {
  it('renders the title and body', () => {
    renderCard(baseTip, 'full')
    expect(screen.getByText(baseTip.title)).toBeInTheDocument()
    // Body content is rendered (markdown emits paragraph + inline code; substring
    // match across the prose wrapper is enough for behavior coverage).
    expect(screen.getByText(/Copy a URL anywhere/)).toBeInTheDocument()
  })

  it('renders the category badge', () => {
    renderCard(baseTip, 'full')
    expect(screen.getByText('bookmarks')).toBeInTheDocument()
  })

  it('renders the audience badge for beginner', () => {
    renderCard(baseTip, 'full')
    expect(screen.getByText('Beginner')).toBeInTheDocument()
  })

  it('renders the audience badge for power', () => {
    renderCard({ ...baseTip, audience: 'power' }, 'full')
    expect(screen.getByText('Power user')).toBeInTheDocument()
  })

  it('hides the audience badge when audience is "all"', () => {
    renderCard({ ...baseTip, audience: 'all' }, 'full')
    expect(screen.queryByText('All')).not.toBeInTheDocument()
  })

  it('renders the shortcut as kbd elements when present', () => {
    const { container } = renderCard({ ...baseTip, shortcut: ['⌘', 'V'] }, 'full')
    const kbds = container.querySelectorAll('kbd')
    expect(kbds.length).toBe(2)
    expect(kbds[0].textContent).toBe('⌘')
    expect(kbds[1].textContent).toBe('V')
  })

  it('omits the shortcut row when shortcut is missing', () => {
    const { container } = renderCard(baseTip, 'full')
    expect(container.querySelector('kbd')).toBeNull()
  })

  it('renders related-doc links pointing at the right paths', () => {
    renderCard(
      {
        ...baseTip,
        relatedDocs: [
          { label: 'Keyboard shortcuts', path: '/docs/features/shortcuts' },
        ],
      },
      'full',
    )
    const link = screen.getByRole('link', { name: 'Keyboard shortcuts' })
    expect(link).toHaveAttribute('href', '/docs/features/shortcuts')
  })

  it('omits the related-doc section when relatedDocs is empty or missing', () => {
    renderCard({ ...baseTip, relatedDocs: [] }, 'full')
    expect(screen.queryByText('Related:')).not.toBeInTheDocument()
  })

  it('renders an image when media kind is image', () => {
    const { container } = renderCard(
      { ...baseTip, media: { kind: 'image', src: '/x.png', alt: 'demo' } },
      'full',
    )
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('does not crash when all optional fields are absent', () => {
    expect(() =>
      renderCard(
        {
          id: 'minimal',
          title: 'Minimal tip',
          body: 'Body text.',
          category: 'editor',
          audience: 'all',
        },
        'full',
      ),
    ).not.toThrow()
  })

  it('exposes a stable hash anchor id matching the tip id', () => {
    const { container } = renderCard(baseTip, 'full')
    expect(container.querySelector('#tip-fixture')).not.toBeNull()
  })
})

describe('TipCard — compact variant', () => {
  it('renders title and body', () => {
    renderCard(baseTip, 'compact')
    expect(screen.getByText(baseTip.title)).toBeInTheDocument()
    expect(screen.getByText(/Copy a URL anywhere/)).toBeInTheDocument()
  })

  it('does not render category or audience badges', () => {
    renderCard(baseTip, 'compact')
    expect(screen.queryByText('bookmarks')).not.toBeInTheDocument()
    expect(screen.queryByText('Beginner')).not.toBeInTheDocument()
  })

  it('does not render the shortcut row even when shortcut is present', () => {
    const { container } = renderCard({ ...baseTip, shortcut: ['⌘', 'V'] }, 'compact')
    expect(container.querySelector('kbd')).toBeNull()
  })

  it('does not render related-doc links even when relatedDocs is present', () => {
    renderCard(
      {
        ...baseTip,
        relatedDocs: [{ label: 'Shortcuts', path: '/docs/features/shortcuts' }],
      },
      'compact',
    )
    expect(screen.queryByRole('link', { name: 'Shortcuts' })).not.toBeInTheDocument()
  })

  it('does not render media even when media is present', () => {
    const { container } = renderCard(
      { ...baseTip, media: { kind: 'image', src: '/x.png', alt: 'demo' } },
      'compact',
    )
    expect(container.querySelector('img')).toBeNull()
  })
})
