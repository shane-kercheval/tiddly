/**
 * Tests for ViewFilterChips component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewFilterChips } from './ViewFilterChips'

describe('ViewFilterChips', () => {
  it('should render Active and Archived chips', () => {
    render(
      <ViewFilterChips
        selectedViews={['active', 'archived']}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(screen.getByText('Include:')).toBeInTheDocument()
  })

  it('should show both chips as selected when both views are active', () => {
    render(
      <ViewFilterChips
        selectedViews={['active', 'archived']}
        onChange={vi.fn()}
      />
    )

    const activeButton = screen.getByText('Active').closest('button')!
    const archivedButton = screen.getByText('Archived').closest('button')!

    expect(activeButton.className).toContain('bg-blue-100')
    expect(archivedButton.className).toContain('bg-blue-100')
  })

  it('should show unselected chip as gray', () => {
    render(
      <ViewFilterChips
        selectedViews={['active']}
        onChange={vi.fn()}
      />
    )

    const archivedButton = screen.getByText('Archived').closest('button')!
    expect(archivedButton.className).toContain('bg-gray-100')
  })

  it('should call onChange when a chip is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ViewFilterChips
        selectedViews={['active', 'archived']}
        onChange={onChange}
      />
    )

    await user.click(screen.getByText('Archived'))
    expect(onChange).toHaveBeenCalledWith('archived')
  })

  it('should disable the only selected chip to prevent empty selection', () => {
    render(
      <ViewFilterChips
        selectedViews={['active']}
        onChange={vi.fn()}
      />
    )

    const activeButton = screen.getByText('Active').closest('button')!
    expect(activeButton).toBeDisabled()
    expect(activeButton.className).toContain('cursor-not-allowed')
  })

  it('should not disable chips when multiple are selected', () => {
    render(
      <ViewFilterChips
        selectedViews={['active', 'archived']}
        onChange={vi.fn()}
      />
    )

    const activeButton = screen.getByText('Active').closest('button')!
    const archivedButton = screen.getByText('Archived').closest('button')!

    expect(activeButton).not.toBeDisabled()
    expect(archivedButton).not.toBeDisabled()
  })
})
