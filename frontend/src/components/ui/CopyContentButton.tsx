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
const FEEDBACK_DURATION = 1000

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
      // Create fetch promise for content
      const contentPromise = (async (): Promise<string> => {
        if (contentType === 'note') {
          const note = await fetchNote(id)
          if (note.content === null || note.content === undefined) {
            throw new Error('No content to copy')
          }
          return note.content
        } else {
          const prompt = await fetchPrompt(id)
          if (prompt.content === null || prompt.content === undefined) {
            throw new Error('No content to copy')
          }
          return prompt.content
        }
      })()

      // Safari requires clipboard operations to be initiated synchronously during
      // user gesture. Using ClipboardItem with a Promise allows us to start the
      // clipboard write immediately while content is fetched asynchronously.
      // Falls back to writeText for browsers that don't support ClipboardItem.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const blobPromise = contentPromise.then(
          (text) => new Blob([text], { type: 'text/plain' })
        )
        const clipboardItem = new ClipboardItem({ 'text/plain': blobPromise })
        await navigator.clipboard.write([clipboardItem])
      } else {
        // Fallback for browsers without ClipboardItem support
        const content = await contentPromise
        await navigator.clipboard.writeText(content)
      }

      setState('success')
    } catch (err) {
      console.error('Failed to copy content:', err)
      setState('error')
    }

    // Reset to idle after feedback duration
    setTimeout(() => setState('idle'), FEEDBACK_DURATION)
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
      className={`btn-icon disabled:cursor-default ${className}`}
      title={getTitle()}
      aria-label={getTitle()}
      disabled={state === 'loading'}
    >
      {getIcon()}
    </button>
  )
}
