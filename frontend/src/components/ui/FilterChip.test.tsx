/**
 * Tests for FilterChip component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterChip } from './FilterChip'

describe('FilterChip', () => {
  describe('rendering', () => {
    it('renders label text', () => {
      render(<FilterChip label="Bookmarks" selected={false} onClick={vi.fn()} />)

      expect(screen.getByText('Bookmarks')).toBeInTheDocument()
    })

    it('renders icon when provided', () => {
      render(
        <FilterChip
          label="Test"
          selected={false}
          onClick={vi.fn()}
          icon={<span data-testid="test-icon">Icon</span>}
        />
      )

      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })

    it('shows checkmark when selected', () => {
      const { container } = render(
        <FilterChip label="Test" selected={true} onClick={vi.fn()} />
      )

      // Checkmark SVG should be present
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('does not show checkmark when not selected', () => {
      const { container } = render(
        <FilterChip label="Test" selected={false} onClick={vi.fn()} />
      )

      // No checkmark SVG
      const svg = container.querySelector('svg')
      expect(svg).not.toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('applies selected styles when selected', () => {
      render(<FilterChip label="Test" selected={true} onClick={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-blue-100', 'text-blue-700')
    })

    it('applies unselected styles when not selected', () => {
      render(<FilterChip label="Test" selected={false} onClick={vi.fn()} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-gray-100', 'text-gray-500')
    })

    it('applies disabled styles when disabled', () => {
      render(<FilterChip label="Test" selected={true} onClick={vi.fn()} disabled={true} />)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('cursor-not-allowed', 'opacity-60')
      expect(button).toBeDisabled()
    })
  })

  describe('interaction', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn()
      render(<FilterChip label="Test" selected={false} onClick={onClick} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not call onClick when disabled', () => {
      const onClick = vi.fn()
      render(<FilterChip label="Test" selected={true} onClick={onClick} disabled={true} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
