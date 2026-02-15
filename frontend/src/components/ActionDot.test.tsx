/**
 * Tests for ActionDot component.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActionDot } from './ActionDot'
import type { HistoryActionType } from '../types'

describe('ActionDot', () => {
  it('test__action_dot__renders_dot_element', () => {
    render(<ActionDot action="update" />)
    expect(screen.getByTestId('action-dot')).toBeInTheDocument()
  })

  it('test__action_dot__renders_correct_style_for_each_action', () => {
    const actionStyles: [HistoryActionType, string][] = [
      ['create', 'bg-emerald-400'],
      ['update', 'bg-blue-400'],
      ['delete', 'bg-red-400'],
      ['restore', 'bg-violet-400'],
      ['undelete', 'border-red-400'],
      ['archive', 'bg-amber-500'],
      ['unarchive', 'border-amber-500'],
    ]

    for (const [action, expectedStyle] of actionStyles) {
      const { unmount } = render(<ActionDot action={action} />)
      const dot = screen.getByTestId('action-dot')
      expect(dot.className).toContain(expectedStyle)
      unmount()
    }
  })

  it('test__action_dot__undo_actions_use_ring_style', () => {
    const { unmount } = render(<ActionDot action="undelete" />)
    let dot = screen.getByTestId('action-dot')
    expect(dot.className).toContain('border-2')
    expect(dot.className).toContain('bg-white')
    unmount()

    render(<ActionDot action="unarchive" />)
    dot = screen.getByTestId('action-dot')
    expect(dot.className).toContain('border-2')
    expect(dot.className).toContain('bg-white')
  })

  it('test__action_dot__is_round', () => {
    render(<ActionDot action="create" />)
    const dot = screen.getByTestId('action-dot')
    expect(dot.className).toContain('rounded-full')
  })

  it('test__action_dot__has_accessible_label', () => {
    render(<ActionDot action="update" />)
    const dot = screen.getByTestId('action-dot')
    expect(dot).toHaveAttribute('role', 'img')
    expect(dot).toHaveAttribute('aria-label', 'Updated')
  })
})
