/**
 * Dialog shown when an entity was modified elsewhere (another tab/device).
 *
 * Appears when the user returns to a tab and the server has a newer version
 * of the entity they were editing.
 */
import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { formatRelativeDate } from '../../utils'

type EntityType = 'note' | 'bookmark' | 'prompt'

interface StaleDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** The server's updated_at timestamp for display */
  serverUpdatedAt: string
  /** Whether the user has unsaved local changes */
  isDirty: boolean
  /** The type of entity (for message) */
  entityType: EntityType
  /** Called when user chooses to load the server version */
  onLoadServerVersion: () => void
  /** Called when user chooses to continue editing */
  onContinueEditing: () => void
}

/**
 * StaleDialog warns users that the entity was modified elsewhere.
 *
 * Shows two options:
 * - Load Server Version: Discard local changes and load the latest version
 * - Continue Editing: Dismiss dialog and keep local content
 */
export function StaleDialog({
  isOpen,
  serverUpdatedAt,
  isDirty,
  entityType,
  onLoadServerVersion,
  onContinueEditing,
}: StaleDialogProps): ReactNode {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onContinueEditing}
      title={`This ${entityType} was modified elsewhere`}
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        <div className="text-sm text-gray-600">
          <p>Server version from {formatRelativeDate(serverUpdatedAt)}.</p>
          {isDirty && (
            <p className="mt-2 text-amber-600 font-medium">
              You have unsaved changes that will be lost if you load the server version.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onLoadServerVersion}
            className="btn-primary w-full"
          >
            Load Server Version
          </button>
          <p className="text-xs text-gray-500 text-center">
            Discard your changes and load the latest version
          </p>

          <button
            type="button"
            onClick={onContinueEditing}
            className="btn-secondary w-full mt-3"
          >
            Continue Editing
          </button>
          <p className="text-xs text-gray-500 text-center">
            Keep your current content and continue editing
          </p>
        </div>
      </div>
    </Modal>
  )
}

interface DeletedDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** The type of entity (for message) */
  entityType: EntityType
  /** Called when user chooses to go back */
  onGoBack: () => void
}

/**
 * DeletedDialog shown when the entity was deleted elsewhere.
 */
export function DeletedDialog({
  isOpen,
  entityType,
  onGoBack,
}: DeletedDialogProps): ReactNode {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onGoBack}
      title={`This ${entityType} was deleted`}
      maxWidth="max-w-sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          This {entityType} was deleted in another tab or device.
        </p>

        <button
          type="button"
          onClick={onGoBack}
          className="btn-primary w-full"
        >
          Go Back
        </button>
      </div>
    </Modal>
  )
}
