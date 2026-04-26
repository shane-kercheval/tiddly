import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TipBody } from './TipBody'

function renderBody(body: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <TipBody body={body} />
    </MemoryRouter>,
  )
}

describe('TipBody', () => {
  it('renders paragraphs', () => {
    renderBody('First paragraph.\n\nSecond paragraph.')
    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })

  it('renders inline code', () => {
    const { container } = renderBody('Press `⌘+V` to paste.')
    const codeElements = container.querySelectorAll('code')
    expect(codeElements.length).toBe(1)
    expect(codeElements[0].textContent).toBe('⌘+V')
  })

  it('renders fenced code blocks', () => {
    const { container } = renderBody('```\nconst x = 1\n```')
    const preElements = container.querySelectorAll('pre')
    expect(preElements.length).toBe(1)
  })

  it('renders bullet lists', () => {
    const { container } = renderBody('- one\n- two\n- three')
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(3)
  })

  it('renders external links with target="_blank" and rel="noopener noreferrer"', () => {
    renderBody('See [docs](https://example.com/docs).')
    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('href', 'https://example.com/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders internal absolute paths via react-router (no target attribute, no rel)', () => {
    renderBody('Open [settings](/app/settings).')
    const link = screen.getByRole('link', { name: 'settings' })
    expect(link).toHaveAttribute('href', '/app/settings')
    // <Link> does not set target=_blank — internal navigation should stay in-tab.
    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
  })

  it('renders fragment-only anchors as plain in-page links', () => {
    renderBody('Jump to [section](#somewhere).')
    const link = screen.getByRole('link', { name: 'section' })
    expect(link).toHaveAttribute('href', '#somewhere')
    expect(link).not.toHaveAttribute('target')
  })

  it('does not render <script> tags from raw HTML in the body', () => {
    const { container } = renderBody('<script>window.alert(1)</script>Safe text.')
    expect(container.querySelector('script')).toBeNull()
  })

  it('does not render dangerous javascript: links', () => {
    renderBody('[click](javascript:alert(1))')
    const link = screen.queryByRole('link')
    // rehype-sanitize strips the unsafe href; either the anchor is removed
    // entirely or its href no longer carries the javascript: protocol.
    if (link !== null) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
  })

  it('strips heading tags so a tip body cannot break the page outline', () => {
    const { container } = renderBody('## Big heading\n\nBody text.')
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelector('h3')).toBeNull()
    expect(container.querySelector('h4')).toBeNull()
    expect(container.querySelector('h5')).toBeNull()
    expect(container.querySelector('h6')).toBeNull()
    // Body content still renders.
    expect(screen.getByText('Body text.')).toBeInTheDocument()
  })
})
