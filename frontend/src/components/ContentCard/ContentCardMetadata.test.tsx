/**
 * Tests for ContentCardMetadata.
 *
 * Covers conditional rendering, callback wiring, and a regression check on
 * the no-tags vertical-alignment shim — the only logic this component owns
 * beyond simple delegation to its child primitives.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentCard, ContentCardMetadata } from './index'

const baseProps = {
  archivedAt: null,
  // Use noon UTC to avoid timezone edge cases in formatShortDate
  createdAt: '2024-01-01T12:00:00Z',
  updatedAt: '2024-01-02T12:00:00Z',
  lastUsedAt: '2024-01-03T12:00:00Z',
  deletedAt: null,
  sortBy: 'created_at' as const,
  showDate: true,
  showArchivedIndicator: false,
}

function renderInCard(node: ReactNode): ReturnType<typeof render> {
  // ContentCardArchiveStatus reads the card view via context.
  return render(<ContentCard>{node}</ContentCard>)
}

describe('ContentCardMetadata', () => {
  describe('tags', () => {
    it('renders tags when provided', () => {
      renderInCard(<ContentCardMetadata {...baseProps} tags={['alpha', 'beta']} />)

      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('beta')).toBeInTheDocument()
    })

    it('renders no tag elements when tags is empty', () => {
      renderInCard(<ContentCardMetadata {...baseProps} tags={[]} />)

      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    })

    it('invokes onTagClick when a tag is clicked', async () => {
      const onTagClick = vi.fn()
      const user = userEvent.setup()
      renderInCard(
        <ContentCardMetadata
          {...baseProps}
          tags={['alpha']}
          onTagClick={onTagClick}
        />,
      )

      await user.click(screen.getByText('alpha'))
      expect(onTagClick).toHaveBeenCalledWith('alpha')
    })
  })

  describe('date', () => {
    it('renders the formatted date when showDate is true', () => {
      renderInCard(<ContentCardMetadata {...baseProps} tags={[]} showDate />)

      expect(screen.getByText('Jan 1, 2024')).toBeInTheDocument()
    })

    it('does not render the date when showDate is false', () => {
      renderInCard(
        <ContentCardMetadata {...baseProps} tags={[]} showDate={false} />,
      )

      expect(screen.queryByText('Jan 1, 2024')).not.toBeInTheDocument()
    })
  })

  describe('archive status', () => {
    it('renders nothing for archive status when neither callback nor indicator is provided', () => {
      renderInCard(<ContentCardMetadata {...baseProps} tags={[]} />)

      // The amber/gray archive badge has no text other than the date —
      // confirm the cancel button (its only interactive element) is absent.
      expect(
        screen.queryByLabelText('Cancel scheduled archive'),
      ).not.toBeInTheDocument()
    })

    it('renders a cancel button when onCancelScheduledArchive is provided and archive is scheduled', () => {
      // archivedAt in the future = scheduled (not yet effective)
      const futureDate = '2099-01-01T00:00:00Z'
      renderInCard(
        <ContentCardMetadata
          {...baseProps}
          tags={[]}
          archivedAt={futureDate}
          onCancelScheduledArchive={vi.fn()}
        />,
      )

      expect(
        screen.getByLabelText('Cancel scheduled archive'),
      ).toBeInTheDocument()
    })

    it('invokes onCancelScheduledArchive when cancel button is clicked', async () => {
      const onCancel = vi.fn()
      const user = userEvent.setup()
      renderInCard(
        <ContentCardMetadata
          {...baseProps}
          tags={[]}
          archivedAt="2099-01-01T00:00:00Z"
          onCancelScheduledArchive={onCancel}
        />,
      )

      await user.click(screen.getByLabelText('Cancel scheduled archive'))
      expect(onCancel).toHaveBeenCalledOnce()
    })
  })

  describe('no-tags alignment shim', () => {
    // Regression check: when tags is empty, archive/date receive `top-1` so
    // they align with the title baseline. If this conditional is ever
    // accidentally removed, the three card types will misalign.
    it('applies top-1 to the date wrapper when tags is empty', () => {
      const { container } = renderInCard(
        <ContentCardMetadata {...baseProps} tags={[]} />,
      )

      const dateWrapper = container.querySelector('span.shrink-0.flex')
      expect(dateWrapper).toHaveClass('top-1')
    })

    it('does not apply top-1 to the date wrapper when tags is non-empty', () => {
      const { container } = renderInCard(
        <ContentCardMetadata {...baseProps} tags={['alpha']} />,
      )

      const dateWrapper = container.querySelector('span.shrink-0.flex')
      expect(dateWrapper).not.toHaveClass('top-1')
    })
  })
})
