/**
 * Tests for BookmarkCard component.
 * Focused on copy button and click tracking behavior.
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
      const bookmarkIconSpan = container.querySelector('.text-blue-500')
      expect(bookmarkIconSpan).toBeInTheDocument()

      // There should be one favicon image (between title and URL)
      const faviconImages = container.querySelectorAll('img')
      expect(faviconImages).toHaveLength(1)
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
      const bookmarkIconSpan = container.querySelector('.text-blue-500')
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
      const bookmarkIconSpan = container.querySelector('.text-blue-500')
      expect(bookmarkIconSpan).not.toBeInTheDocument()

      // Favicon should still be visible (now in left position)
      const faviconImages = container.querySelectorAll('img')
      expect(faviconImages).toHaveLength(1)
    })
  })

  describe('copy button', () => {
    it('copies URL to clipboard when clicked', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<BookmarkCard bookmark={mockBookmark} onDelete={vi.fn()} />)

      const copyButton = screen.getByRole('button', { name: /copy url/i })
      await userEvent.click(copyButton)

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

      const copyButton = screen.getByRole('button', { name: /copy url/i })
      await userEvent.click(copyButton)

      expect(onLinkClick).toHaveBeenCalledWith(mockBookmark)
    })

    it('shows checkmark icon after successful copy', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<BookmarkCard bookmark={mockBookmark} onDelete={vi.fn()} />)

      const copyButton = screen.getByRole('button', { name: /copy url/i })
      await userEvent.click(copyButton)

      // Button should now show "Copied!" title
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
      })
    })
  })

  describe('link click tracking', () => {
    it('calls onLinkClick when link is clicked normally', async () => {
      const onLinkClick = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      // Click the title link
      const link = screen.getByRole('link', { name: /example article/i })
      fireEvent.click(link)

      expect(onLinkClick).toHaveBeenCalledWith(mockBookmark)
    })

    it('does NOT call onLinkClick when shift+cmd+clicking (silent mode)', () => {
      const onLinkClick = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const link = screen.getByRole('link', { name: /example article/i })
      fireEvent.click(link, { shiftKey: true, metaKey: true })

      expect(onLinkClick).not.toHaveBeenCalled()
    })

    it('does NOT call onLinkClick when shift+ctrl+clicking (silent mode on Windows)', () => {
      const onLinkClick = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const link = screen.getByRole('link', { name: /example article/i })
      fireEvent.click(link, { shiftKey: true, ctrlKey: true })

      expect(onLinkClick).not.toHaveBeenCalled()
    })

    it('DOES call onLinkClick when only cmd+clicking (not silent mode)', () => {
      const onLinkClick = vi.fn()

      render(
        <BookmarkCard
          bookmark={mockBookmark}
          onDelete={vi.fn()}
          onLinkClick={onLinkClick}
        />
      )

      const link = screen.getByRole('link', { name: /example article/i })
      fireEvent.click(link, { metaKey: true })

      // cmd+click without shift should still track
      expect(onLinkClick).toHaveBeenCalledWith(mockBookmark)
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

      // Tag buttons have the tag name as their accessible name
      const tagButton = screen.getByRole('button', { name: 'test' })
      await userEvent.click(tagButton)

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

      // Hover to reveal remove button, then click
      const removeButton = screen.getByRole('button', { name: /remove tag test/i })
      await userEvent.click(removeButton)

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

      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
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

      expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument()
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
