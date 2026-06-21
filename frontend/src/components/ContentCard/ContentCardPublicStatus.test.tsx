/**
 * Tests for ContentCardPublicStatus — the at-a-glance "this item is public"
 * indicator. Renders a labeled globe only when the item is public.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContentCardPublicStatus } from './ContentCardPublicStatus'

describe('ContentCardPublicStatus', () => {
  it('renders a "Public" indicator when the item is public', () => {
    render(<ContentCardPublicStatus isPublic={true} />)
    expect(screen.getByLabelText('Public')).toBeInTheDocument()
  })

  it('renders nothing when the item is not public', () => {
    const { container } = render(<ContentCardPublicStatus isPublic={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByLabelText('Public')).not.toBeInTheDocument()
  })
})
