/**
 * Tests for the Tips docs page.
 *
 * Tests run against the live `allTips` seed corpus (the same pinning approach
 * M1 uses for selectors) so reorderings or content changes are caught here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DocsTips } from './DocsTips'
import { allTips } from '../../data/tips'

// Skip the 200 ms debounce so search-driven tests run synchronously.
vi.mock('../../hooks/useDebouncedValue', () => ({
  useDebouncedValue: (value: string) => value,
}))

function renderAtRoute(initialEntry: string = '/docs/tips'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DocsTips />
    </MemoryRouter>,
  )
}

function getRenderedTipIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-tip-id]')).map(
    (el) => el.getAttribute('data-tip-id') ?? '',
  )
}

describe('DocsTips', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView']
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders every tip exactly once, ordered by global priority ascending', () => {
    const { container } = renderAtRoute()
    // Pinned id order matches the seed corpus priorities (10, 20, 30, 40, 50).
    // If the order ever changes silently in tips.ts, this test should fail —
    // that's the regression flag for "the docs page rank just shifted."
    expect(getRenderedTipIds(container)).toEqual([
      'note-slash-commands',
      'prompt-template-arguments',
      'bookmark-paste-url',
      'search-quoted-phrase',
      'shortcut-select-next-occurrence',
    ])
  })

  it('renders the page title and intro copy', () => {
    renderAtRoute()
    expect(screen.getByRole('heading', { level: 1, name: 'Tips' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search tips...')).toBeInTheDocument()
  })

  it('renders each tip with its deep-link DOM id', () => {
    const { container } = renderAtRoute()
    expect(container.querySelector('#tip-note-slash-commands')).not.toBeNull()
    expect(container.querySelector('#tip-bookmark-paste-url')).not.toBeNull()
  })

  it('search filters case-insensitively on title', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    await user.type(screen.getByLabelText('Search tips'), 'PASTING')
    await waitFor(() => {
      expect(getRenderedTipIds(container)).toEqual(['bookmark-paste-url'])
    })
  })

  it('search filters case-insensitively on body', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    // note-slash-commands body mentions "callouts"
    await user.type(screen.getByLabelText('Search tips'), 'callouts')
    await waitFor(() => {
      expect(getRenderedTipIds(container)).toEqual(['note-slash-commands'])
    })
  })

  it('shows the empty state when search matches nothing', async () => {
    const user = userEvent.setup()
    renderAtRoute()
    await user.type(screen.getByLabelText('Search tips'), 'xyzzy-no-such-tip')
    await waitFor(() => {
      expect(screen.getByText('No tips match your filters')).toBeInTheDocument()
    })
  })

  it('clicking a category chip narrows the list to tips that claim that category', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    const bookmarksChip = screen.getByRole('button', { name: /^bookmarks$/ })
    await user.click(bookmarksChip)

    const rendered = getRenderedTipIds(container)
    expect(rendered).toContain('bookmark-paste-url')
    expect(rendered).not.toContain('note-slash-commands')
    expect(rendered).not.toContain('prompt-template-arguments')
  })

  it('a multi-category tip surfaces whenever ANY of its categories is selected', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    // bookmark-paste-url is in both 'bookmarks' and 'shortcuts'. Selecting
    // 'shortcuts' alone still surfaces it.
    await user.click(screen.getByRole('button', { name: /^shortcuts$/ }))
    expect(getRenderedTipIds(container)).toContain('bookmark-paste-url')
  })

  it('multiple category chips compose with OR (multi-select)', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    await user.click(screen.getByRole('button', { name: /^bookmarks$/ }))
    await user.click(screen.getByRole('button', { name: /^notes$/ }))

    const rendered = getRenderedTipIds(container)
    expect(rendered).toContain('bookmark-paste-url')
    expect(rendered).toContain('note-slash-commands')
    expect(rendered).not.toContain('prompt-template-arguments')
  })

  it('clicking the same category chip twice clears its selection', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    const bookmarksChip = screen.getByRole('button', { name: /^bookmarks$/ })
    await user.click(bookmarksChip)
    await user.click(bookmarksChip)

    expect(getRenderedTipIds(container).length).toBe(allTips.length)
  })

  it('audience filter "Beginner" includes both beginner-targeted AND universal ("all") tips', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    await user.click(screen.getByRole('radio', { name: 'Beginner' }))

    const rendered = getRenderedTipIds(container)
    expect(rendered).toContain('bookmark-paste-url') // audience: 'beginner'
    expect(rendered).toContain('note-slash-commands') // audience: 'beginner'
    expect(rendered).toContain('search-quoted-phrase') // audience: 'all'
  })

  it('audience filter "Beginner" excludes power-user-only tips', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    await user.click(screen.getByRole('radio', { name: 'Beginner' }))

    expect(getRenderedTipIds(container))
      .not.toContain('shortcut-select-next-occurrence') // audience: 'power'
  })

  it('audience filter "Power user" includes power tips and universal tips', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    await user.click(screen.getByRole('radio', { name: 'Power user' }))

    const rendered = getRenderedTipIds(container)
    expect(rendered).toContain('shortcut-select-next-occurrence')
    expect(rendered).toContain('search-quoted-phrase')
    expect(rendered).not.toContain('bookmark-paste-url')
  })

  it('combining search + category + audience intersects all three', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    // "press" appears in bookmark-paste-url (beginner, bookmarks+shortcuts)
    // and shortcut-select-next-occurrence (power, shortcuts+editor).
    await user.type(screen.getByLabelText('Search tips'), 'press')
    await user.click(screen.getByRole('button', { name: /^shortcuts$/ }))
    await user.click(screen.getByRole('radio', { name: 'Power user' }))

    expect(getRenderedTipIds(container)).toEqual(['shortcut-select-next-occurrence'])
  })

  it('navigates to a deep-link and scrolls the matching tip into view on mount', async () => {
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView']

    renderAtRoute('/docs/tips#tip-bookmark-paste-url')

    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled()
    })
    const target = scrollSpy.mock.instances[0] as HTMLElement
    expect(target.id).toBe('tip-bookmark-paste-url')
  })

  it('does not throw when deep-linking to an unknown tip id', () => {
    expect(() => {
      renderAtRoute('/docs/tips#tip-nonexistent')
    }).not.toThrow()
  })

  it('renders the audience filter as a radiogroup with the active option marked aria-checked', async () => {
    const user = userEvent.setup()
    renderAtRoute()
    const radiogroup = screen.getByRole('radiogroup', { name: /audience/i })
    expect(radiogroup).toBeInTheDocument()

    // Default: "All" is the active radio.
    const allOption = within(radiogroup).getByRole('radio', { name: 'All' })
    expect(allOption).toHaveAttribute('aria-checked', 'true')

    // Clicking another option flips aria-checked.
    await user.click(within(radiogroup).getByRole('radio', { name: 'Beginner' }))
    expect(within(radiogroup).getByRole('radio', { name: 'Beginner' }))
      .toHaveAttribute('aria-checked', 'true')
    expect(within(radiogroup).getByRole('radio', { name: 'All' }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('"Clear filters" in the empty state resets search, category, and audience in one click', async () => {
    const user = userEvent.setup()
    const { container } = renderAtRoute()
    // Get into the empty state by combining filters that match nothing.
    await user.type(screen.getByLabelText('Search tips'), 'xyzzy-no-such-tip')
    await user.click(screen.getByRole('button', { name: /^bookmarks$/ }))
    await user.click(screen.getByRole('radio', { name: 'Power user' }))

    await waitFor(() => {
      expect(screen.getByText('No tips match your filters')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => {
      // Full corpus restored — same shape as the no-filter render.
      expect(getRenderedTipIds(container).length).toBe(allTips.length)
    })
    // And the input/audience defaults are back.
    expect(screen.getByLabelText('Search tips')).toHaveValue('')
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true')
  })

  it('renders related-doc links inside cards as in-app router links (no new tab)', () => {
    const { container } = renderAtRoute()
    const card = container.querySelector('[data-tip-id="bookmark-paste-url"]')
    expect(card).not.toBeNull()
    const link = within(card as HTMLElement).getByRole('link', {
      name: 'Keyboard shortcuts',
    })
    expect(link).toHaveAttribute('href', '/docs/features/shortcuts')
    expect(link).not.toHaveAttribute('target')
  })
})
