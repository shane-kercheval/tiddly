/**
 * Owner share control for the item detail toolbar.
 *
 * Two states, driven by `fields.is_public` (NOT by token presence — the backend
 * retains `public_token` when unpublished so re-publishing restores the same URL,
 * so a previously-shared-then-unshared item still has a token while being private):
 * - private   → an explainer + "Create share link" (publishes; privacy-sensitive,
 *               hence an explicit action rather than publishing on toolbar click)
 * - shared    → the public URL + copy, "Stop sharing", and "Regenerate link"
 *               (rotate, behind an inline confirm because it breaks the old URL)
 *
 * The detail page owns the item's local state; this control reports the updated
 * item (every share endpoint returns the full detail response) via
 * `onShareStateChanged` so the displayed token refreshes. Rendered inside the
 * toolbar's `{!readOnly && …}` block, so it never appears on the public view.
 */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { SharedIcon, LinkIcon, ArrowPathIcon } from './icons'
import { CopyToClipboardButton } from './ui/CopyToClipboardButton'
import { getApiErrorMessage } from '../utils'
import { GLOBALLY_TOASTED_STATUSES } from '../services/api'
import { useShareMutations, type ShareableType, type ShareItemByType } from '../hooks/useShareMutations'

/** Minimal shape the control reads; every owner type (Bookmark/Note/Prompt) satisfies it. */
interface ShareableItem {
  id: string
  is_public: boolean
  public_token: string | null
}

interface ShareControlProps<K extends ShareableType> {
  type: K
  // Bound to `type` via ShareItemByType, so a type/item mismatch won't compile.
  item: ShareItemByType[K]
  /** Called with the updated item after publish/unpublish/rotate so the page can refresh its state. */
  onShareStateChanged: (updated: ShareItemByType[K]) => void
  disabled?: boolean
}

const SINGULAR: Record<ShareableType, string> = {
  bookmarks: 'bookmark',
  notes: 'note',
  prompts: 'prompt',
}

/** Per-type brand color, used to flag the trigger when the item is shared. */
const ACTIVE_COLOR: Record<ShareableType, string> = {
  bookmarks: 'text-brand-bookmark',
  notes: 'text-brand-note',
  prompts: 'text-brand-prompt',
}

export function ShareControl<K extends ShareableType>({
  type,
  item,
  onShareStateChanged,
  disabled = false,
}: ShareControlProps<K>): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const [confirmingRotate, setConfirmingRotate] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { publish, unpublish, rotate } = useShareMutations(type)

  // Read share fields through the common base (item is ShareItemByType[K] for a
  // generic K; the base spares us per-branch narrowing).
  const fields: ShareableItem = item

  const isPending = publish.isPending || unpublish.isPending || rotate.isPending
  // Block in-panel share actions while the parent is mid-save (the trigger is
  // already disabled, but the panel can stay open via a keyboard save).
  const controlsDisabled = disabled || isPending

  // Closing also resets the rotate confirmation, so reopening starts clean.
  const closePanel = useCallback((): void => {
    setIsOpen(false)
    setConfirmingRotate(false)
  }, [])

  // Close on outside click / Escape (mirrors QuickAddMenu).
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePanel()
      }
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return (): void => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, closePanel])

  const shareUrl = fields.public_token
    ? `${window.location.origin}/shared/${type}/${fields.public_token}`
    : ''

  const handleError = (err: unknown, fallback: string): void => {
    // 402 (quota) and 429 (rate limit) are toasted by the shared interceptor.
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status && (GLOBALLY_TOASTED_STATUSES as readonly number[]).includes(status)) return
    toast.error(getApiErrorMessage(err, fallback))
  }

  const handlePublish = async (): Promise<void> => {
    try {
      onShareStateChanged(await publish.mutateAsync(fields.id))
    } catch (err) {
      handleError(err, 'Failed to create share link')
    }
  }

  const handleUnpublish = async (): Promise<void> => {
    try {
      onShareStateChanged(await unpublish.mutateAsync(fields.id))
    } catch (err) {
      handleError(err, 'Failed to stop sharing')
    }
  }

  const handleRotate = async (): Promise<void> => {
    try {
      onShareStateChanged(await rotate.mutateAsync(fields.id))
      setConfirmingRotate(false)
      toast.success('New link generated')
    } catch (err) {
      handleError(err, 'Failed to regenerate link')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (isOpen ? closePanel() : setIsOpen(true))}
        disabled={disabled}
        aria-label="Share"
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={`btn-ghost flex items-center gap-2 ${fields.is_public ? ACTIVE_COLOR[type] : ''}`}
      >
        <SharedIcon className="h-4 w-4" />
        <span className="hidden md:inline">Share</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg">
          {!fields.is_public ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">Share this {SINGULAR[type]}</p>
              <p className="text-xs text-gray-500">
                Create a public link anyone can open — no account needed. They’ll see a read-only view and can save their own copy.
              </p>
              <button
                type="button"
                onClick={handlePublish}
                disabled={controlsDisabled}
                className="btn-primary w-full justify-center"
              >
                {publish.isPending ? 'Creating…' : 'Create share link'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">Anyone with this link can view</p>
                <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1">
                  <LinkIcon className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="truncate text-xs text-gray-700" title={shareUrl}>{shareUrl}</span>
                  <CopyToClipboardButton content={shareUrl} title="Copy link" className="ml-auto shrink-0" />
                </div>
              </div>

              {confirmingRotate ? (
                <div className="space-y-2 rounded-md bg-amber-50 p-2 ring-1 ring-inset ring-amber-200">
                  <p className="text-xs text-amber-800">
                    Regenerating breaks the current link — anyone with it loses access.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRotate}
                      disabled={controlsDisabled}
                      className="btn-secondary flex items-center gap-1.5"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      {rotate.isPending ? 'Regenerating…' : 'Regenerate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRotate(false)}
                      disabled={controlsDisabled}
                      className="btn-ghost"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleUnpublish}
                    disabled={controlsDisabled}
                    className="btn-ghost text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {unpublish.isPending ? 'Stopping…' : 'Stop sharing'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRotate(true)}
                    disabled={controlsDisabled}
                    className="btn-ghost flex items-center gap-1.5"
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    Regenerate link
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
