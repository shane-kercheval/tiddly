/**
 * Tests for the read-only display mode of the inline fields used on the public
 * share view. In readOnly mode they must render plain, selectable text (or a
 * link for URLs) — no input chrome, no hover ring, no edit affordances.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InlineEditableTitle } from './InlineEditableTitle'
import { InlineEditableText } from './InlineEditableText'
import { InlineEditableUrl } from './InlineEditableUrl'

describe('inline fields — readOnly display mode', () => {
  it('InlineEditableTitle renders plain text, not an input', () => {
    render(<InlineEditableTitle value="My Title" onChange={() => {}} readOnly />)
    expect(screen.getByText('My Title')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('InlineEditableText renders plain text, not a textarea', () => {
    render(<InlineEditableText value="A description" onChange={() => {}} readOnly />)
    expect(screen.getByText('A description')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('InlineEditableUrl renders a safe external link, not an input', () => {
    render(<InlineEditableUrl value="https://example.com" onChange={() => {}} readOnly />)
    const link = screen.getByRole('link', { name: 'https://example.com' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
