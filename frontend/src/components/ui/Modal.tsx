/**
 * Reusable modal dialog component.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { CloseIcon } from '../icons'

interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Called when the modal should close */
  onClose: () => void
  /** Modal title */
  title: ReactNode
  /** Modal content */
  children: ReactNode
  /** Maximum width class (default: max-w-lg) */
  maxWidth?: string
  /** Whether to remove content padding (default: false) */
  noPadding?: boolean
  /** Whether the modal can be closed via escape key/close button (default: true) */
  canClose?: boolean
}

/**
 * Modal dialog with backdrop, close button, and accessibility support.
 *
 * Features:
 * - Escape key to close
 * - Focus trap (focuses first input on open)
 * - Scroll lock when open
 * - ARIA attributes for accessibility
 * - Portal rendering (renders at document.body to avoid DOM nesting issues)
 *
 * Note: Clicking outside does NOT close the modal to prevent accidental
 * data loss. Use Escape key or close button to dismiss.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  noPadding = false,
  canClose = true,
}: ModalProps): ReactNode {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Handle escape key and focus management
  useEffect(() => {
    if (!isOpen) return

    // Store currently focused element to restore later
    previousActiveElement.current = document.activeElement as HTMLElement

    // Prevent body scroll
    document.body.style.overflow = 'hidden'

    // Focus first focusable element in modal using requestAnimationFrame
    // for more reliable timing than setTimeout
    let animationFrameId: number | null = null
    animationFrameId = requestAnimationFrame(() => {
      const firstInput = modalRef.current?.querySelector<HTMLInputElement>(
        'input, textarea, select, button:not([aria-label="Close"])'
      )
      firstInput?.focus()
    })

    // Handle escape key - always stop propagation when modal is open to prevent
    // other document-level listeners (like note/bookmark close handlers) from firing
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (canClose) {
          onClose()
        }
      }
    }

    // Use capture phase to ensure modal handles Escape before other listeners
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKeyDown, true)
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }

      // Restore focus to previously focused element
      if (previousActiveElement.current) {
        previousActiveElement.current.focus()
      }
    }
  }, [isOpen, onClose, canClose])

  if (!isOpen) return null

  // Use portal to render at document.body level, avoiding DOM nesting issues
  // (e.g., nested forms, z-index problems, overflow clipping)
  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div ref={modalRef} className={`modal-content ${maxWidth}`}>
        {/* Header - fixed at top */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 flex-shrink-0">
          <h2 id="modal-title" className="text-base font-semibold text-gray-900">
            {title}
          </h2>
          {canClose && (
            <button
              onClick={onClose}
              className="btn-icon"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        {/* Content - scrollable */}
        <div className={`flex-1 min-h-0 overflow-y-auto ${noPadding ? '' : 'px-6 py-4'}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
