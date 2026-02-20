/**
 * Tests for TableOfContentsSidebar component.
 *
 * Covers:
 * - Rendering headings from content
 * - Empty state when no headings
 * - Heading click callback with correct line number
 * - Indentation based on heading level
 * - Close button calls store's setActivePanel(null)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TableOfContentsSidebar } from './TableOfContentsSidebar'

// Mock the sidebar store
const mockSetActivePanel = vi.fn()
vi.mock('../stores/rightSidebarStore', () => ({
  useRightSidebarStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setActivePanel: mockSetActivePanel, width: 320 }),
  MIN_SIDEBAR_WIDTH: 300,
  MIN_CONTENT_WIDTH: 400,
}))

// Mock the resize hook with controllable isDesktop
let mockIsDesktop = true
vi.mock('../hooks/useResizableSidebar', () => ({
  useResizableSidebar: () => ({
    width: 320,
    get isDesktop() { return mockIsDesktop },
    isDragging: false,
    handleMouseDown: vi.fn(),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockIsDesktop = true
})

describe('TableOfContentsSidebar', () => {
  it('should render headings from content', () => {
    const content = '# Heading 1\n\nSome text\n\n## Heading 2\n\n### Heading 3'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={vi.fn()} />
    )

    expect(screen.getByText('Heading 1')).toBeInTheDocument()
    expect(screen.getByText('Heading 2')).toBeInTheDocument()
    expect(screen.getByText('Heading 3')).toBeInTheDocument()
  })

  it('should render empty state when no headings found', () => {
    const content = 'Just some text without any headings.'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={vi.fn()} />
    )

    expect(screen.getByText(/No headings found/)).toBeInTheDocument()
    expect(screen.getByText(/Use # to add headings/)).toBeInTheDocument()
  })

  it('should render empty state for empty content', () => {
    render(
      <TableOfContentsSidebar content="" onHeadingClick={vi.fn()} />
    )

    expect(screen.getByText(/No headings found/)).toBeInTheDocument()
  })

  it('should call onHeadingClick with correct line number', () => {
    const onHeadingClick = vi.fn()
    const content = 'Some text\n\n# First Heading\n\nMore text\n\n## Second Heading'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={onHeadingClick} />
    )

    fireEvent.click(screen.getByText('First Heading'))
    expect(onHeadingClick).toHaveBeenCalledWith(3)

    fireEvent.click(screen.getByText('Second Heading'))
    expect(onHeadingClick).toHaveBeenCalledWith(7)
  })

  it('should indent headings based on level', () => {
    const content = '# H1\n## H2\n### H3\n#### H4'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={vi.fn()} />
    )

    // H1 = 16px (base), H2 = 32px, H3 = 48px, H4 = 64px
    const h1Button = screen.getByText('H1').closest('button')!
    const h2Button = screen.getByText('H2').closest('button')!
    const h3Button = screen.getByText('H3').closest('button')!
    const h4Button = screen.getByText('H4').closest('button')!

    expect(h1Button.style.paddingLeft).toBe('16px')
    expect(h2Button.style.paddingLeft).toBe('32px')
    expect(h3Button.style.paddingLeft).toBe('48px')
    expect(h4Button.style.paddingLeft).toBe('64px')
  })

  it('should apply font-medium to H1 and H2 headings', () => {
    const content = '# H1\n## H2\n### H3'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={vi.fn()} />
    )

    const h1Span = screen.getByText('H1')
    const h2Span = screen.getByText('H2')
    const h3Span = screen.getByText('H3')

    expect(h1Span.className).toContain('font-medium')
    expect(h2Span.className).toContain('font-medium')
    expect(h3Span.className).not.toContain('font-medium')
  })

  it('should close sidebar when close button is clicked', () => {
    const content = '# Heading'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={vi.fn()} />
    )

    // Find the close button (the one that doesn't contain heading text)
    const headerButtons = screen.getAllByRole('button')
    const closeBtn = headerButtons.find(btn => !btn.textContent?.includes('Heading'))!
    fireEvent.click(closeBtn)

    expect(mockSetActivePanel).toHaveBeenCalledWith(null)
  })

  it('should update headings when content changes', () => {
    const { rerender } = render(
      <TableOfContentsSidebar content="# First" onHeadingClick={vi.fn()} />
    )

    expect(screen.getByText('First')).toBeInTheDocument()

    rerender(
      <TableOfContentsSidebar content={`# Updated\n## New`} onHeadingClick={vi.fn()} />
    )

    expect(screen.queryByText('First')).not.toBeInTheDocument()
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('should not close sidebar on heading click in desktop mode', () => {
    mockIsDesktop = true
    const content = '# Heading'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={vi.fn()} />
    )

    fireEvent.click(screen.getByText('Heading'))
    expect(mockSetActivePanel).not.toHaveBeenCalled()
  })

  it('should close sidebar on heading click in mobile mode', () => {
    mockIsDesktop = false
    const onHeadingClick = vi.fn()
    const content = '# Heading'
    render(
      <TableOfContentsSidebar content={content} onHeadingClick={onHeadingClick} />
    )

    fireEvent.click(screen.getByText('Heading'))
    expect(onHeadingClick).toHaveBeenCalledWith(1)
    expect(mockSetActivePanel).toHaveBeenCalledWith(null)
  })

  it('should render header with title', () => {
    render(
      <TableOfContentsSidebar content="# Heading" onHeadingClick={vi.fn()} />
    )

    expect(screen.getByText('Table of Contents')).toBeInTheDocument()
  })
})
