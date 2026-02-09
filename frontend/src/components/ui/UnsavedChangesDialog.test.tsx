/**
 * Tests for UnsavedChangesDialog component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

describe('UnsavedChangesDialog', () => {
  const defaultProps = {
    isOpen: true,
    onStay: vi.fn(),
    onLeave: vi.fn(),
  }

  describe('rendering', () => {
    it('should render dialog when isOpen is true', () => {
      render(<UnsavedChangesDialog {...defaultProps} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
      expect(screen.getByText(/You have unsaved changes/)).toBeInTheDocument()
    })

    it('should not render dialog when isOpen is false', () => {
      render(<UnsavedChangesDialog {...defaultProps} isOpen={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render Stay and Leave buttons', () => {
      render(<UnsavedChangesDialog {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Stay' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
    })
  })

  describe('interactions', () => {
    it('should call onStay when Stay button is clicked', async () => {
      const onStay = vi.fn()
      render(<UnsavedChangesDialog {...defaultProps} onStay={onStay} />)

      await userEvent.click(screen.getByRole('button', { name: 'Stay' }))

      expect(onStay).toHaveBeenCalledTimes(1)
    })

    it('should call onLeave when Leave button is clicked', async () => {
      const onLeave = vi.fn()
      render(<UnsavedChangesDialog {...defaultProps} onLeave={onLeave} />)

      await userEvent.click(screen.getByRole('button', { name: 'Leave' }))

      expect(onLeave).toHaveBeenCalledTimes(1)
    })

    it('should call onStay when close button is clicked', async () => {
      const onStay = vi.fn()
      render(<UnsavedChangesDialog {...defaultProps} onStay={onStay} />)

      // Modal's close button
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(onStay).toHaveBeenCalledTimes(1)
    })

    it('should call onStay when Escape key is pressed', async () => {
      const onStay = vi.fn()
      render(<UnsavedChangesDialog {...defaultProps} onStay={onStay} />)

      await userEvent.keyboard('{Escape}')

      expect(onStay).toHaveBeenCalledTimes(1)
    })
  })

  describe('button styling', () => {
    it('should have danger styling on Leave button', () => {
      render(<UnsavedChangesDialog {...defaultProps} />)

      const leaveButton = screen.getByRole('button', { name: 'Leave' })
      expect(leaveButton.className).toContain('btn-danger')
    })

    it('should have secondary styling on Stay button', () => {
      render(<UnsavedChangesDialog {...defaultProps} />)

      const stayButton = screen.getByRole('button', { name: 'Stay' })
      expect(stayButton.className).toContain('btn-secondary')
    })
  })

  describe('button types', () => {
    it('should have type="button" on Stay button to prevent form submission', () => {
      render(<UnsavedChangesDialog {...defaultProps} />)

      const stayButton = screen.getByRole('button', { name: 'Stay' })
      expect(stayButton).toHaveAttribute('type', 'button')
    })

    it('should have type="button" on Leave button to prevent form submission', () => {
      render(<UnsavedChangesDialog {...defaultProps} />)

      const leaveButton = screen.getByRole('button', { name: 'Leave' })
      expect(leaveButton).toHaveAttribute('type', 'button')
    })
  })

  describe('form interaction', () => {
    it('should not submit parent form when Stay is clicked', async () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
      const onStay = vi.fn()

      render(
        <form onSubmit={onSubmit}>
          <UnsavedChangesDialog {...defaultProps} onStay={onStay} />
        </form>
      )

      await userEvent.click(screen.getByRole('button', { name: 'Stay' }))

      expect(onStay).toHaveBeenCalledTimes(1)
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should not submit parent form when Leave is clicked', async () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
      const onLeave = vi.fn()

      render(
        <form onSubmit={onSubmit}>
          <UnsavedChangesDialog {...defaultProps} onLeave={onLeave} />
        </form>
      )

      await userEvent.click(screen.getByRole('button', { name: 'Leave' }))

      expect(onLeave).toHaveBeenCalledTimes(1)
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
