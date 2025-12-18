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
  id: 1,
  url: 'https://example.com/article',
  title: 'Example Article',
  description: 'A test bookmark',
  tags: ['test', 'example'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: null,
  is_archived: false,
  is_deleted: false,
}

describe('BookmarkCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    it('shows green color briefly after successful copy', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      render(<BookmarkCard bookmark={mockBookmark} onDelete={vi.fn()} />)

      const copyButton = screen.getByRole('button', { name: /copy url/i })
      await userEvent.click(copyButton)

      // Check for green class immediately after click
      await waitFor(() => {
        expect(copyButton.className).toContain('text-green-600')
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
})
