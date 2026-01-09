/**
 * Dialog shown when user tries to navigate away with unsaved changes.
 */
import type { ReactNode } from 'react'
import { Modal } from './Modal'

interface UnsavedChangesDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when user chooses to stay on the page */
  onStay: () => void
  /** Called when user chooses to leave without saving */
  onLeave: () => void
}

/**
 * UnsavedChangesDialog warns users about losing unsaved changes.
 *
 * Shows two options:
 * - Stay: Cancel navigation and remain on current page
 * - Leave: Proceed with navigation and discard changes
 */
export function UnsavedChangesDialog({
  isOpen,
  onStay,
  onLeave,
}: UnsavedChangesDialogProps): ReactNode {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onStay}
      title="Unsaved Changes"
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          You have unsaved changes that will be lost if you leave this page.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onStay}
            className="btn-secondary"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="btn-danger"
          >
            Leave
          </button>
        </div>
      </div>
    </Modal>
  )
}
