import type { ReactNode } from 'react'
import { CopyIcon, CheckIcon } from './icons'
import { useCopyFeedback } from '../hooks/useCopyFeedback'

interface AgentPromptCardProps {
  /** Short directive shown above the prompt (e.g. where to paste it). */
  explanation: ReactNode
  /** The ready-to-paste prompt text. */
  prompt: string
  /** Extra classes for the outer card (e.g. width, shadow) supplied by callers. */
  className?: string
}

/**
 * The prompt card itself: a short directive, the prompt in a scrollable
 * monospace body, and a labeled copy control. Rendered inside AgentPromptButton's
 * popover, or inline on surfaces (e.g. the first-run empty state) that want the
 * card shown directly without a button to open it.
 *
 * Reuses the same clipboard-feedback plumbing as CopyToClipboardButton; we render
 * our own labeled "Copy prompt" button rather than the icon-only component.
 */
export function AgentPromptCard({
  explanation,
  prompt,
  className = '',
}: AgentPromptCardProps): ReactNode {
  const { state, setSuccess, setError } = useCopyFeedback()

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
    <div
      className={`overflow-hidden rounded-xl border border-gray-200 bg-white text-left ${className}`}
    >
      <p className="px-4 pb-2.5 pt-3 text-[13px] font-semibold leading-relaxed text-gray-700">
        {explanation}
      </p>
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
  )
}
