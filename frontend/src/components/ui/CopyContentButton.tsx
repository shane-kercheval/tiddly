/**
 * Button to copy note or prompt content to clipboard.
 * Fetches content via API since list views don't include full content.
 */
import { useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { CopyIcon, CheckIcon } from '../icons'
import { useNotes } from '../../hooks/useNotes'
import { usePrompts } from '../../hooks/usePrompts'

type CopyState = 'idle' | 'loading' | 'success' | 'error'

interface CopyContentButtonProps {
  /** Type of content to copy */
  contentType: 'note' | 'prompt'
  /** ID of the content item */
  id: string
  /** Optional class name for the button */
  className?: string
}

/** Duration to show success/error state before returning to idle (ms) */
const FEEDBACK_DURATION = 2000

/**
 * CopyContentButton fetches content and copies it to clipboard.
 *
 * States:
 * - idle: Shows copy icon
 * - loading: Shows spinner while fetching
 * - success: Shows green checkmark for 2s
 * - error: Shows red X for 2s
 */
export function CopyContentButton({
  contentType,
  id,
  className = '',
}: CopyContentButtonProps): ReactNode {
  const [state, setState] = useState<CopyState>('idle')
  const { fetchNote } = useNotes()
  const { fetchPrompt } = usePrompts()

  const handleCopy = useCallback(async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation() // Prevent card click

    if (state === 'loading') return // Prevent double-clicks

    setState('loading')

    try {
      // Fetch full content
      let content: string | null = null
      if (contentType === 'note') {
        const note = await fetchNote(id)
        content = note.content
      } else {
        const prompt = await fetchPrompt(id)
        content = prompt.content
      }

      // Copy to clipboard
      if (content) {
        await navigator.clipboard.writeText(content)
        setState('success')
      } else {
        // No content to copy
        setState('error')
      }
    } catch {
      setState('error')
    }

    // Reset to idle after feedback duration
    setTimeout(() => {
      setState('idle')
    }, FEEDBACK_DURATION)
  }, [state, contentType, id, fetchNote, fetchPrompt])

  const getTitle = (): string => {
    switch (state) {
      case 'loading':
        return 'Copying...'
      case 'success':
        return 'Copied!'
      case 'error':
        return 'Failed to copy'
      default:
        return `Copy ${contentType} content`
    }
  }

  const getIcon = (): ReactNode => {
    switch (state) {
      case 'loading':
        return <div className="spinner-xs" />
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
      onClick={handleCopy}
      className={`btn-icon ${className}`}
      title={getTitle()}
      aria-label={getTitle()}
      disabled={state === 'loading'}
    >
      {getIcon()}
    </button>
  )
}
