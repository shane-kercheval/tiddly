/**
 * Tests for BookmarkCard component.
 * Focused on copy button and click tracking behavior.
 *
 * Note: BookmarkCard renders both mobile and desktop layouts (hidden via CSS).
 * Tests use getAllByRole and take the first match for elements that appear twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookmarkCard } from './BookmarkCard'
import type { BookmarkListItem } from '../types'

const mockBookmark: BookmarkListItem = {
  id: '1',
  url: 'https://example.com/article',
  title: 'Example Article',
  description: 'A test bookmark',
  summary: null,
  tags: ['test', 'example'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

describe('BookmarkCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('showContentTypeIcon prop', () => {
    it('test__BookmarkCard__shows_bookmark_icon_by_default', () => {
      const { container } = render(<BookmarkCard bookmark={mockBookmark} onDelete={vi.fn()} />)

      // BookmarkIcon should be rendered (it's in a span with the blue color class)
      const bookmarkIconSpan = container.querySelector('.text-brand-bookmark')
      expect(bookmarkIconSpan).toBeInTheDocument()

      // There should be multiple favicon images (mobile + desktop layouts)
      const faviconImages = container.querySelectorAll('img')
      expect(faviconImages.length).toBeGreaterThan(0)
    })

    it('test__BookmarkCard__shows_bookmark_icon_when_showContentTypeIcon_true', () => {
      const { container } = render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          showContentTypeIcon={true}
        />
      )

      // BookmarkIcon should be rendered
      const bookmarkIconSpan = container.querySelector('.text-brand-bookmark')
      expect(bookmarkIconSpan).toBeInTheDocument()
    })

    it('test__BookmarkCard__hides_bookmark_icon_when_showContentTypeIcon_false', () => {
      const { container } = render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          showContentTypeIcon={false}
        />
      )

      // BookmarkIcon should NOT be rendered
      const bookmarkIconSpan = container.querySelector('.text-brand-bookmark')
      expect(bookmarkIconSpan).not.toBeInTheDocument()

      // Favicon should still be visible (now in left position)
      const faviconImages = container.querySelectorAll('img')
      expect(faviconImages.length).toBeGreaterThan(0)
    })
  })

  describe('copy button', () => {
    it('copies URL to clipboard when clicked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<BookmarkCard bookmark={mockBookmark} onDelete={vi.fn()} />)

      // Multiple copy buttons exist (mobile + desktop), click the first one
      const copyButtons = screen.getAllByRole('button', { name: /copy url/i })
      await userEvent.click(copyButtons[0])

      expect(writeText).toHaveBeenCalledWith('https://example.com/article')
    })

    it('calls onLinkClick to track usage when copying', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })
      const onLinkClick = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const copyButtons = screen.getAllByRole('button', { name: /copy url/i })
      await userEvent.click(copyButtons[0])

      expect(onLinkClick).toHaveBeenCalledWith(mockBookmark)
    })

    it('shows checkmark icon after successful copy', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<BookmarkCard bookmark={mockBookmark} onDelete={vi.fn()} />)

      const copyButtons = screen.getAllByRole('button', { name: /copy url/i })
      await userEvent.click(copyButtons[0])

      // Button should now show "Copied!" title
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /copied/i }).length).toBeGreaterThan(0)
      })
    })
  })

  describe('URL click tracking', () => {
    it('calls onLinkClick when URL line is clicked', async () => {
      const onLinkClick = vi.fn()
      // Mock window.open
      const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      // Click the URL button (multiple exist for mobile/desktop)
      const urlButtons = screen.getAllByTitle('https://example.com/article')
      fireEvent.click(urlButtons[0])

      expect(onLinkClick).toHaveBeenCalledWith(mockBookmark)
      expect(windowOpen).toHaveBeenCalledWith(
        'https://example.com/article',
        '_blank',
        'noopener,noreferrer'
      )

      windowOpen.mockRestore()
    })

    it('does NOT call onLinkClick when shift+cmd+clicking URL (silent mode)', () => {
      const onLinkClick = vi.fn()
      const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const urlButtons = screen.getAllByTitle('https://example.com/article')
      fireEvent.click(urlButtons[0], { shiftKey: true, metaKey: true })

      // Silent mode should not track
      expect(onLinkClick).not.toHaveBeenCalled()
      // But should still open the URL
      expect(windowOpen).toHaveBeenCalled()

      windowOpen.mockRestore()
    })

    it('does NOT call onLinkClick when shift+ctrl+clicking URL (silent mode on Windows)', () => {
      const onLinkClick = vi.fn()
      const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const urlButtons = screen.getAllByTitle('https://example.com/article')
      fireEvent.click(urlButtons[0], { shiftKey: true, ctrlKey: true })

      expect(onLinkClick).not.toHaveBeenCalled()

      windowOpen.mockRestore()
    })

    it('DOES call onLinkClick when only cmd+clicking URL (not silent mode)', () => {
      const onLinkClick = vi.fn()
      const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const urlButtons = screen.getAllByTitle('https://example.com/article')
      fireEvent.click(urlButtons[0], { metaKey: true })

      // cmd+click without shift should still track
      expect(onLinkClick).toHaveBeenCalledWith(mockBookmark)

      windowOpen.mockRestore()
    })
  })

  describe('card click behavior', () => {
    it('calls onEdit when card is clicked (not on URL)', () => {
      const onEdit = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onEdit={onEdit}
        />
      )

      // Click on the title (multiple exist for mobile/desktop)
      const titles = screen.getAllByText('Example Article')
      fireEvent.click(titles[0])

      expect(onEdit).toHaveBeenCalledWith(mockBookmark)
    })

    it('does not call onEdit when card is clicked in deleted view', () => {
      const onEdit = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          view="deleted"
          onDelete={vi.fn()}
          onEdit={onEdit}
        />
      )

      const titles = screen.getAllByText('Example Article')
      fireEvent.click(titles[0])

      expect(onEdit).not.toHaveBeenCalled()
    })
  })

  describe('tag clicks', () => {
    it('calls onTagClick when a tag is clicked', async () => {
      const onTagClick = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onTagClick={onTagClick}
        />
      )

      // Tag buttons appear in both mobile and desktop layouts
      const tagButtons = screen.getAllByRole('button', { name: 'test' })
      await userEvent.click(tagButtons[0])

      expect(onTagClick).toHaveBeenCalledWith('test')
    })
  })

  describe('tag removal', () => {
    it('should call onTagRemove when tag remove button is clicked', async () => {
      const onTagRemove = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onTagRemove={onTagRemove}
        />
      )

      // Multiple remove buttons exist (mobile + desktop)
      const removeButtons = screen.getAllByRole('button', { name: /remove tag test/i })
      await userEvent.click(removeButtons[0])

      expect(onTagRemove).toHaveBeenCalledWith(mockBookmark, 'test')
    })
  })

  describe('tag addition', () => {
    const mockSuggestions = [
      { name: 'react', content_count: 5, filter_count: 0 },
      { name: 'typescript', content_count: 3, filter_count: 0 },
    ]

    it('should show add tag button when onTagAdd is provided', () => {
      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      // Multiple add tag buttons exist (mobile + desktop)
      const addButtons = screen.getAllByRole('button', { name: 'Add tag' })
      expect(addButtons.length).toBeGreaterThan(0)
    })

    it('should not show add tag button when onTagAdd is not provided', () => {
      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })

    it('should show add tag button even when item has zero tags', () => {
      const bookmarkWithNoTags = { ...mockBookmark, tags: [] }

      render(
        <BookmarkCard
          bookmark={bookmarkWithNoTags}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
          tagSuggestions={mockSuggestions}
        />
      )

      const addButtons = screen.getAllByRole('button', { name: 'Add tag' })
      expect(addButtons.length).toBeGreaterThan(0)
    })

    it('should not show add tag button when tagSuggestions is not provided', () => {
      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onTagAdd={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { name: 'Add tag' })).not.toBeInTheDocument()
    })
  })
})
