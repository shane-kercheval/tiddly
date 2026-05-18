import { afterEach, describe, it, expect, vi } from 'vitest'
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

function mockPlatform(value: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
})

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

  describe('shortcut tokens', () => {
    it('renders a body token as a localized Kbd on Mac', () => {
      mockPlatform('MacIntel')
      const { container } = renderBody('Press `{{shortcut:app.commandPalette}}` to open.')
      // Inline code with the token should become a kbd, not a code element.
      expect(container.querySelector('code')).toBeNull()
      const kbds = container.querySelectorAll('kbd')
      expect(kbds.length).toBe(1)
      // formatShortcut on Mac joins with no separator → ⌘⇧P.
      expect(kbds[0].textContent).toBe('⌘⇧P')
    })

    it('renders a body token as a localized Kbd on Windows', () => {
      mockPlatform('Win32')
      const { container } = renderBody('Press `{{shortcut:app.commandPalette}}` to open.')
      const kbds = container.querySelectorAll('kbd')
      expect(kbds.length).toBe(1)
      // formatShortcut on Windows joins with + and translates glyphs.
      expect(kbds[0].textContent).toBe('Ctrl+Shift+P')
    })

    it('renders an extras-module token (page.save) as a single Kbd', () => {
      mockPlatform('MacIntel')
      const { container } = renderBody('Use `{{shortcut:page.save}}` to save.')
      const kbds = container.querySelectorAll('kbd')
      expect(kbds.length).toBe(1)
      expect(kbds[0].textContent).toBe('⌘S')
    })

    it('renders a non-token inline code span as a default code element, not a Kbd', () => {
      const { container } = renderBody('Open `tips.ts` to edit.')
      const codes = container.querySelectorAll('code')
      const kbds = container.querySelectorAll('kbd')
      expect(codes.length).toBe(1)
      expect(codes[0].textContent).toBe('tips.ts')
      expect(kbds.length).toBe(0)
      // Pin: the `code` component override forwards `className` only — never
      // spreads `...rest`. react-markdown internal props like `node` must not
      // leak to the DOM (would produce React "Unknown prop" warnings and
      // serialize into the HTML).
      expect(codes[0].hasAttribute('node')).toBe(false)
    })

    it('preserves className on fenced code blocks (language-* hints) without leaking node prop', () => {
      // react-markdown attaches `className="language-ts"` to fenced blocks
      // with a language tag. The override must forward it for downstream
      // syntax highlighting (if/when added) without spreading other
      // internal props.
      const { container } = renderBody('```ts\nconst x = 1\n```')
      const code = container.querySelector('pre > code')
      expect(code).not.toBeNull()
      expect(code!.getAttribute('class')).toBe('language-ts')
      expect(code!.hasAttribute('node')).toBe(false)
    })

    it('passes through a mixed-content code span unchanged', () => {
      // Token-shaped text mixed with other content inside one backtick pair is
      // NOT the exact-match grammar — it should render as default code.
      const { container } = renderBody('Code: `Press {{shortcut:app.commandPalette}}`.')
      const codes = container.querySelectorAll('code')
      const kbds = container.querySelectorAll('kbd')
      expect(codes.length).toBe(1)
      expect(codes[0].textContent).toBe('Press {{shortcut:app.commandPalette}}')
      expect(kbds.length).toBe(0)
    })

    it('renders multiple tokens in one body as independent Kbds', () => {
      mockPlatform('MacIntel')
      const { container } = renderBody(
        'First `{{shortcut:app.commandPalette}}`, then `{{shortcut:page.save}}`.',
      )
      const kbds = container.querySelectorAll('kbd')
      expect(kbds.length).toBe(2)
      expect(kbds[0].textContent).toBe('⌘⇧P')
      expect(kbds[1].textContent).toBe('⌘S')
    })

    it('does not render bare token text outside a code span as a Kbd', () => {
      // Outside an inline code span the override never fires; the literal
      // text shows up in the rendered HTML (validation catches stale ids).
      const { container } = renderBody('Bare {{shortcut:app.commandPalette}} text.')
      expect(container.querySelector('kbd')).toBeNull()
      expect(container.textContent).toContain('{{shortcut:app.commandPalette}}')
    })

    it('renders fenced code blocks as <pre> regardless of their content', () => {
      // A fenced block containing token-shaped text is multi-line and won't
      // match the single-line regex; it must render as pre/code.
      const { container } = renderBody('```\n{{shortcut:app.commandPalette}}\n```')
      expect(container.querySelector('pre')).not.toBeNull()
      // No kbd in the fenced block.
      const kbds = container.querySelectorAll('kbd')
      expect(kbds.length).toBe(0)
    })
  })
})
