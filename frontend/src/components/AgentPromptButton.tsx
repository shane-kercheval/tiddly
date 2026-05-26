import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { DropdownPortal, type DropdownPortalHandle } from './ui/DropdownPortal'
import { ChevronDownIcon, CopyIcon, CheckIcon } from './icons'
import { useCopyFeedback } from '../hooks/useCopyFeedback'

interface AgentPromptButtonProps {
  /** Trigger button text. */
  buttonLabel: string
  /** Short directive shown above the prompt (e.g. where to paste it). */
  explanation: ReactNode
  /** The ready-to-paste prompt text. */
  prompt: string
  /**
   * Full className for the trigger button. Defaults to an outlined secondary
   * style matching the public header buttons; callers (e.g. Milestone 4
   * surfaces) can override to fit their context.
   */
  buttonClassName?: string
  /** Show the dropdown caret on the trigger (default true). */
  showCaret?: boolean
}

const DEFAULT_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-5 py-1.5 text-sm font-medium text-gray-900 transition-all hover:bg-gray-50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2'

const POPOVER_WIDTH = 384 // w-96

/**
 * A button that opens an anchored popover containing a ready-to-paste prompt
 * for the user's AI agent: a short directive, the prompt in a scrollable
 * monospace body, and a labeled copy control. Reusable across surfaces
 * (landing-page evaluation CTA, in-app integration prompts) by varying the
 * label/explanation/prompt props.
 */
export function AgentPromptButton({
  buttonLabel,
  explanation,
  prompt,
  buttonClassName = DEFAULT_BUTTON_CLASS,
  showCaret = true,
}: AgentPromptButtonProps): ReactNode {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const portalRef = useRef<DropdownPortalHandle>(null)
  // Reuse the same clipboard-feedback plumbing CopyToClipboardButton uses; we
  // render our own labeled "Copy prompt" button rather than the icon-only one.
  const { state, setSuccess, setError } = useCopyFeedback()

  // Close on outside click (treating the portaled popover as "inside") and Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent): void {
      const target = e.target as Node
      if (anchorRef.current?.contains(target)) return
      if (portalRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function copyPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt)
      setSuccess()
    } catch (err) {
      console.error('Failed to copy prompt:', err)
      setError()
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={buttonClassName}
      >
        {buttonLabel}
        {showCaret && (
          <ChevronDownIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      <DropdownPortal
        ref={portalRef}
        anchorRef={anchorRef}
        open={open}
        dropdownWidth={POPOVER_WIDTH}
      >
        <div className="mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-2xl">
          <p className="px-4 pb-2.5 pt-3 text-[13px] font-semibold leading-relaxed text-gray-700">{explanation}</p>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words border-t border-gray-100 px-4 py-3 font-mono text-xs leading-relaxed text-gray-700">
            {prompt}
          </div>
          <div className="flex justify-end border-t border-gray-100 px-3 py-2">
            <button
              type="button"
              onClick={copyPrompt}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              {state === 'success' ? (
                <CheckIcon className="h-4 w-4 text-green-600" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
              {state === 'success' ? 'Copied!' : 'Copy prompt'}
            </button>
          </div>
        </div>
      </DropdownPortal>
    </>
  )
}
