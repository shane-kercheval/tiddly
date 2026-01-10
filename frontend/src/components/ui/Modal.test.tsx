/**
 * Tests for Modal component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from './Modal'

describe('Modal', () => {
  describe('rendering', () => {
    it('should render when isOpen is true', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Test Modal')).toBeInTheDocument()
      expect(screen.getByText('Modal content')).toBeInTheDocument()
    })

    it('should not render when isOpen is false', () => {
      render(
        <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render with custom maxWidth', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal" maxWidth="max-w-xl">
          <p>Modal content</p>
        </Modal>
      )

      const modalContent = screen.getByRole('dialog').querySelector('.modal-content')
      expect(modalContent).toHaveClass('max-w-xl')
    })
  })

  describe('close behavior', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      fireEvent.click(screen.getByLabelText('Close'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not call onClose when canClose is false and Escape is pressed', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Test Modal" canClose={false}>
          <p>Modal content</p>
        </Modal>
      )

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('should disable close button when canClose is false', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal" canClose={false}>
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByLabelText('Close')).toBeDisabled()
    })
  })

  describe('Escape key propagation', () => {
    it('should stop Escape key from propagating to other document handlers', () => {
      const modalOnClose = vi.fn()
      const otherHandler = vi.fn()

      // Add another document-level handler to simulate parent component's escape handler
      // This simulates the scenario where a note detail page also listens for Escape
      document.addEventListener('keydown', otherHandler)

      render(
        <Modal isOpen={true} onClose={modalOnClose} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      // Create and dispatch a real keyboard event to properly test propagation
      // Using native event dispatch instead of fireEvent for accurate propagation behavior
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      document.dispatchEvent(event)

      // Modal should close
      expect(modalOnClose).toHaveBeenCalledTimes(1)

      // Other handler should NOT have been called because modal uses
      // stopImmediatePropagation in capture phase
      expect(otherHandler).not.toHaveBeenCalled()

      // Clean up
      document.removeEventListener('keydown', otherHandler)
    })

    it('should stop bubble phase handlers when using capture phase', () => {
      const modalOnClose = vi.fn()
      const bubbleHandler = vi.fn()

      // Render modal first - its capture phase handler is registered
      render(
        <Modal isOpen={true} onClose={modalOnClose} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      // Add bubble phase handler AFTER modal renders
      // This simulates a parent component's Escape handler
      document.addEventListener('keydown', bubbleHandler)

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      document.dispatchEvent(event)

      // Modal should close
      expect(modalOnClose).toHaveBeenCalledTimes(1)

      // Bubble handler should NOT be called because modal's capture phase
      // handler uses stopImmediatePropagation
      expect(bubbleHandler).not.toHaveBeenCalled()

      // Clean up
      document.removeEventListener('keydown', bubbleHandler)
    })
  })

  describe('focus management', () => {
    it('should focus first input when modal opens', async () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
          <input data-testid="first-input" type="text" />
          <input data-testid="second-input" type="text" />
        </Modal>
      )

      // Wait for requestAnimationFrame
      await new Promise((resolve) => requestAnimationFrame(resolve))

      expect(screen.getByTestId('first-input')).toHaveFocus()
    })
  })

  describe('body scroll lock', () => {
    it('should prevent body scroll when open', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      expect(document.body.style.overflow).toBe('hidden')
    })

    it('should restore body scroll when closed', () => {
      const { rerender } = render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      expect(document.body.style.overflow).toBe('hidden')

      rerender(
        <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      expect(document.body.style.overflow).toBe('')
    })
  })

  describe('accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(
        <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
          <p>Modal content</p>
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
    })
  })
})
