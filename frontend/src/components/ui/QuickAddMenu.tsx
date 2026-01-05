/**
 * QuickAddMenu - dropdown menu for quickly adding bookmarks, notes, or prompts.
 *
 * Shows a + button that reveals a dropdown with options to add bookmark, note, or prompt.
 * When only one content type is available, shows a direct button without dropdown.
 */
import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { ContentType } from '../../types'
import { PlusIcon, BookmarkIcon, NoteIcon, PromptIcon } from '../icons'

interface QuickAddMenuProps {
  /** Called when "New Bookmark" is clicked */
  onAddBookmark: () => void
  /** Called when "New Note" is clicked */
  onAddNote: () => void
  /** Called when "New Prompt" is clicked */
  onAddPrompt: () => void
  /** Content types to show options for. Defaults to ['bookmark', 'note', 'prompt'] */
  contentTypes?: ContentType[]
}

export function QuickAddMenu({
  onAddBookmark,
  onAddNote,
  onAddPrompt,
  contentTypes,
}: QuickAddMenuProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Determine which content types to show
  const types = contentTypes ?? ['bookmark', 'note', 'prompt']
  const showBookmark = types.includes('bookmark')
  const showNote = types.includes('note')
  const showPrompt = types.includes('prompt')
  const isSingleType = types.length === 1

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close menu when pressing escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return (): void => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const handleAddBookmark = (): void => {
    onAddBookmark()
    setIsOpen(false)
  }

  const handleAddNote = (): void => {
    onAddNote()
    setIsOpen(false)
  }

  const handleAddPrompt = (): void => {
    onAddPrompt()
    setIsOpen(false)
  }

  // Single content type: render direct button (same appearance as dropdown trigger)
  if (isSingleType) {
    const handleClick = showBookmark ? onAddBookmark : showNote ? onAddNote : onAddPrompt
    const title = showBookmark ? 'Add bookmark' : showNote ? 'Add note' : 'Add prompt'

    return (
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        title={title}
        data-testid="quick-add-single"
      >
        <PlusIcon className="h-5 w-5" />
      </button>
    )
  }

  // Multiple content types: render dropdown menu
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        title="Add new item"
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-testid="quick-add-menu-trigger"
      >
        <PlusIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          data-testid="quick-add-menu-dropdown"
        >
          {showBookmark && (
            <button
              type="button"
              onClick={handleAddBookmark}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              data-testid="quick-add-bookmark"
            >
              <BookmarkIcon className="h-4 w-4 text-gray-500" />
              <span>New Bookmark</span>
            </button>
          )}
          {showNote && (
            <button
              type="button"
              onClick={handleAddNote}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              data-testid="quick-add-note"
            >
              <NoteIcon className="h-4 w-4 text-gray-500" />
              <span>New Note</span>
            </button>
          )}
          {showPrompt && (
            <button
              type="button"
              onClick={handleAddPrompt}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              data-testid="quick-add-prompt"
            >
              <PromptIcon className="h-4 w-4 text-gray-500" />
              <span>New Prompt</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
