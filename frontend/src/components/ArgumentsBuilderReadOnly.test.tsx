/**
 * Tests for ArgumentsBuilder's read-only public view: arguments render as plain
 * text with no edit controls (+ add, × remove, ↑↓ reorder, inputs, checkbox).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ArgumentsBuilder } from './ArgumentsBuilder'
import type { PromptArgument } from '../types'

const args: PromptArgument[] = [
  { name: 'language', description: 'Programming language', required: true },
  { name: 'focus', description: null, required: false },
]

describe('ArgumentsBuilder — read-only public view', () => {
  it('renders arguments as text with no edit controls', () => {
    render(<ArgumentsBuilder arguments={args} onChange={() => {}} readOnly />)

    expect(screen.getByText('language')).toBeInTheDocument()
    expect(screen.getByText('Programming language')).toBeInTheDocument()
    expect(screen.getByText('focus')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('Optional')).toBeInTheDocument()

    // No edit affordances.
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByLabelText('Add argument')).toBeNull()
    expect(screen.queryByLabelText(/Remove argument/)).toBeNull()
    expect(screen.queryByLabelText(/Move argument/)).toBeNull()
  })

  it('renders nothing (no empty box) when there are no arguments', () => {
    const { container } = render(<ArgumentsBuilder arguments={[]} onChange={() => {}} readOnly />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Arguments')).toBeNull()
  })
})
