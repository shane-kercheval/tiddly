import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { DropdownPortal, type DropdownPortalHandle } from './ui/DropdownPortal'
import { ChevronDownIcon } from './icons'
import { AgentPromptCard } from './AgentPromptCard'

interface AgentPromptButtonProps {
  /** Trigger button text. */
  buttonLabel: string
  /** Short directive shown above the prompt (e.g. where to paste it). */
  explanation: ReactNode
  /** The ready-to-paste prompt text. */
  prompt: string
  /**
   * Full className for the trigger button. Defaults to an outlined secondary
   * style matching the public header buttons; callers (e.g. the landing/features
   * marketing surfaces) can override to fit their context.
   */
  buttonClassName?: string
  /** Show the dropdown caret on the trigger (default true). */
  showCaret?: boolean
}

const DEFAULT_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-5 py-1.5 text-sm font-medium text-gray-900 transition-all hover:bg-gray-50 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2'

const POPOVER_WIDTH = 384 // w-96

/**
 * A button that opens an anchored popover containing an AgentPromptCard — a
 * ready-to-paste prompt for the user's AI agent. Reusable across surfaces
 * (landing/features evaluation CTA, in-app integration CTA) by varying the
 * label/explanation/prompt props. Surfaces that want the card shown inline
 * (no button) render AgentPromptCard directly instead.
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
        <AgentPromptCard
          explanation={explanation}
          prompt={prompt}
          className="mt-2 w-96 max-w-[calc(100vw-2rem)] shadow-2xl"
        />
      </DropdownPortal>
    </>
  )
}
