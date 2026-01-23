/**
 * Dialog shown when an entity was modified elsewhere (another tab/device).
 *
 * Appears when the user returns to a tab and the server has a newer version
 * of the entity they were editing.
 */
import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { CopyIcon, CheckIcon } from '../icons'

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
  /** The user's current editor content (for copy when dirty) */
  currentContent?: string
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
 *
 * When user has unsaved changes, also shows Copy My Content button.
 */
export function StaleDialog({
  isOpen,
  serverUpdatedAt: _serverUpdatedAt,
  isDirty,
  entityType,
  currentContent,
  onLoadServerVersion,
  onContinueEditing,
}: StaleDialogProps): ReactNode {
  const { state: copyState, setSuccess: setCopySuccess, setError: setCopyError } = useCopyFeedback()

  const handleCopyContent = async (): Promise<void> => {
    if (!currentContent) return
    try {
      await navigator.clipboard.writeText(currentContent)
      setCopySuccess()
    } catch {
      setCopyError()
    }
  }

  const getCopyButtonContent = (): ReactNode => {
    if (copyState === 'success') {
      return (
        <>
          <CheckIcon className="h-4 w-4 text-green-600" />
          <span>Copied!</span>
        </>
      )
    }
    if (copyState === 'error') {
      return (
        <>
          <CopyIcon className="h-4 w-4 text-red-500" />
          <span>Failed</span>
        </>
      )
    }
    return (
      <>
        <CopyIcon className="h-4 w-4" />
        <span>Copy My Content</span>
      </>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onContinueEditing}
      title={`This ${entityType} was modified`}
      maxWidth="max-w-md"
    >
      <div className="space-y-4">
        <div className="text-sm text-gray-600">
          <p>A newer version was detected on the server.</p>
          {isDirty && (
            <p className="mt-2 text-amber-600 font-medium">
              You have unsaved changes that will be lost if you load the server version.
            </p>
          )}
        </div>

        <div className="space-y-2">
          {/* Copy My Content - only shown when dirty */}
          {isDirty && currentContent && (
            <>
              <button
                type="button"
                onClick={handleCopyContent}
                className="btn-secondary w-full flex items-center justify-center gap-2"
                disabled={copyState === 'loading'}
              >
                {getCopyButtonContent()}
              </button>
              <p className="text-xs text-gray-500 text-center">
                Copy your current content to clipboard before choosing an action
              </p>
            </>
          )}

          <button
            type="button"
            onClick={onLoadServerVersion}
            className={`btn-primary w-full ${isDirty && currentContent ? 'mt-3' : ''}`}
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
