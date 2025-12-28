/**
 * QuickAddMenu - dropdown menu for quickly adding bookmarks or notes.
 *
 * Shows a + button that reveals a dropdown with options to add bookmark or note.
 */
import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { PlusIcon, BookmarkIcon, NoteIcon } from '../icons'

interface QuickAddMenuProps {
  /** Called when "New Bookmark" is clicked */
  onAddBookmark: () => void
  /** Called when "New Note" is clicked */
  onAddNote: () => void
}

export function QuickAddMenu({
  onAddBookmark,
  onAddNote,
}: QuickAddMenuProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        title="Add new item"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <PlusIcon className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={handleAddBookmark}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            <BookmarkIcon className="h-4 w-4 text-gray-500" />
            <span>New Bookmark</span>
          </button>
          <button
            type="button"
            onClick={handleAddNote}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            <NoteIcon className="h-4 w-4 text-gray-500" />
            <span>New Note</span>
          </button>
        </div>
      )}
    </div>
  )
}
