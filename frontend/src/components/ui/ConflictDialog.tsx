/**
 * Dialog shown when a save attempt returns 409 Conflict.
 *
 * Appears when the user tries to save but the entity was modified
 * on the server since they loaded it.
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { CopyIcon, CheckIcon } from '../icons'

interface ConflictDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** The user's current editor content (for copy) */
  currentContent: string
  /** Called when user chooses to load the server version */
  onLoadServerVersion: () => void
  /** Called when user chooses to force save their version (overwrites server) */
  onSaveMyVersion: () => void
  /** Called when user chooses to do nothing (close dialog, keep local changes unsaved) */
  onDoNothing: () => void
}

/**
 * ConflictDialog shows options when a save attempt conflicts with server changes.
 *
 * Shows four options:
 * - Copy My Content: Copies current editor content to clipboard
 * - Load Latest Version: Discard local changes and load the latest version
 * - Save My Version: Force save local changes (requires confirmation)
 * - Do Nothing: Close dialog, keep local changes in editor (unsaved)
 */
export function ConflictDialog({
  isOpen,
  currentContent,
  onLoadServerVersion,
  onSaveMyVersion,
  onDoNothing,
}: ConflictDialogProps): ReactNode {
  // State for "Save My Version" confirmation
  const [isConfirmingSave, setIsConfirmingSave] = useState(false)
  const confirmTimeoutRef = useRef<number | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)

  // Copy feedback state
  const {
    state: copyState,
    setLoading: setCopyLoading,
    setSuccess: setCopySuccess,
    setError: setCopyError,
    reset: resetCopy,
  } = useCopyFeedback()

  // Reset confirmation state when dialog closes
  // This is intentional - resetting local UI state when prop changes is a valid pattern
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsConfirmingSave(false)
      resetCopy()
      if (confirmTimeoutRef.current) {
        window.clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [isOpen, resetCopy])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) {
        window.clearTimeout(confirmTimeoutRef.current)
      }
    }
  }, [])

  // Reset confirmation when clicking outside the save button
  useEffect(() => {
    if (!isConfirmingSave) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (saveButtonRef.current && !saveButtonRef.current.contains(e.target as Node)) {
        setIsConfirmingSave(false)
        if (confirmTimeoutRef.current) {
          window.clearTimeout(confirmTimeoutRef.current)
          confirmTimeoutRef.current = null
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isConfirmingSave])

  const handleCopyContent = async (): Promise<void> => {
    try {
      setCopyLoading()
      await navigator.clipboard.writeText(currentContent)
      setCopySuccess()
    } catch {
      setCopyError()
    }
  }

  const handleSaveMyVersionClick = (): void => {
    if (isConfirmingSave) {
      // Second click - execute save
      setIsConfirmingSave(false)
      if (confirmTimeoutRef.current) {
        window.clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
      onSaveMyVersion()
    } else {
      // First click - show confirmation
      setIsConfirmingSave(true)
      confirmTimeoutRef.current = window.setTimeout(() => {
        setIsConfirmingSave(false)
      }, 3000)
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
      onClose={onDoNothing}
      title="Save Conflict"
      maxWidth="max-w-md"
      canClose={false}
    >
      <div className="space-y-4">
        <div className="text-sm">
          <p className="text-amber-600 font-medium">
            Your changes could not be saved because the server has a newer version.
          </p>
        </div>

        <div className="space-y-2">
          {/* Copy My Content - always visible at top */}
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

          {/* Load Latest Version */}
          <button
            type="button"
            onClick={onLoadServerVersion}
            className="btn-primary w-full mt-3"
          >
            Load Latest Version
          </button>
          <p className="text-xs text-gray-500 text-center">
            Discard your changes and load the latest version
          </p>

          {/* Save My Version - requires confirmation */}
          <button
            ref={saveButtonRef}
            type="button"
            onClick={handleSaveMyVersionClick}
            className={`w-full mt-3 ${
              isConfirmingSave
                ? 'btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 bg-red-50'
                : 'btn-secondary text-amber-600 hover:text-amber-700 hover:border-amber-300'
            }`}
          >
            {isConfirmingSave ? 'Confirm Overwrite?' : 'Save My Version'}
          </button>
          <p className="text-xs text-gray-500 text-center">
            Overwrite server changes with your version
          </p>

          {/* Do Nothing */}
          <button
            type="button"
            onClick={onDoNothing}
            className="btn-secondary w-full mt-3"
          >
            Do Nothing
          </button>
          <p className="text-xs text-gray-500 text-center">
            Close this dialog and continue editing (changes remain unsaved)
          </p>
        </div>
      </div>
    </Modal>
  )
}
