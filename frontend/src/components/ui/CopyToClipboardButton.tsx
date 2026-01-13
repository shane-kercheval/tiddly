/**
 * Button to copy provided content to clipboard.
 * Unlike CopyContentButton, this doesn't fetch via API - it copies content directly.
 */
import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { CopyIcon, CheckIcon } from '../icons'

type CopyState = 'idle' | 'success' | 'error'

interface CopyToClipboardButtonProps {
  /** Content to copy to clipboard */
  content: string
  /** Optional class name for the button */
  className?: string
  /** Optional title override */
  title?: string
}

/** Duration to show success/error state before returning to idle (ms) */
const FEEDBACK_DURATION = 1000

/**
 * CopyToClipboardButton copies provided content to clipboard.
 *
 * States:
 * - idle: Shows copy icon
 * - success: Shows green checkmark
 * - error: Shows red icon
 */
export function CopyToClipboardButton({
  content,
  className = '',
  title = 'Copy content',
}: CopyToClipboardButtonProps): ReactNode {
  const [state, setState] = useState<CopyState>('idle')

  const handleCopy = useCallback(async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()

    if (!content) {
      setState('error')
      setTimeout(() => setState('idle'), FEEDBACK_DURATION)
      return
    }

    try {
      await navigator.clipboard.writeText(content)
      setState('success')
    } catch (err) {
      console.error('Failed to copy content:', err)
      setState('error')
    }

    setTimeout(() => setState('idle'), FEEDBACK_DURATION)
  }, [content])

  const getTitle = (): string => {
    switch (state) {
      case 'success':
        return 'Copied!'
      case 'error':
        return 'Failed to copy'
      default:
        return title
    }
  }

  const getIcon = (): ReactNode => {
    switch (state) {
      case 'success':
        return <CheckIcon className="h-4 w-4 text-green-600" />
      case 'error':
        return <CopyIcon className="h-4 w-4 text-red-500" />
      default:
        return <CopyIcon className="h-4 w-4" />
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ${className}`}
      title={getTitle()}
      aria-label={getTitle()}
      tabIndex={-1}
    >
      {getIcon()}
    </button>
  )
}
