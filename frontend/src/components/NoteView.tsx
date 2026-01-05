/**
 * Component for viewing a note with rendered markdown content.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Note } from '../types'
import { formatDate } from '../utils'
import { EditIcon, ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon } from './icons'
import { MarkdownViewer } from './MarkdownEditor'

interface NoteViewProps {
  note: Note
  view?: 'active' | 'archived' | 'deleted'
  fullWidth?: boolean
  onEdit?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  onDelete?: () => void
  onRestore?: () => void
  onTagClick?: (tag: string) => void
  onBack?: () => void
}

/**
 * NoteView displays a note with rendered markdown content.
 *
 * Features:
 * - Renders markdown using react-markdown with GFM support
 * - XSS protection via rehype-sanitize
 * - Shows title, description, tags, and metadata
 * - Edit button to switch to edit mode
 * - Context-aware actions based on view state
 */
export function NoteView({
  note,
  view = 'active',
  fullWidth = false,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onTagClick,
  onBack,
}: NoteViewProps): ReactNode {
  // Keyboard shortcuts: 'e' to edit, Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Skip if in an input, textarea, or contenteditable
      const activeElement = document.activeElement
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement)?.isContentEditable
      ) {
        return
      }

      // Escape to close
      if (e.key === 'Escape' && onBack) {
        e.preventDefault()
        onBack()
        return
      }

      // 'e' to edit (without modifiers)
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && onEdit) {
        e.preventDefault()
        onEdit()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onEdit, onBack])

  return (
    <div className={`flex flex-col h-full w-full ${fullWidth ? '' : 'max-w-4xl'}`}>
      {/* Fixed header with back button and actions */}
      <div className="shrink-0 bg-white flex items-center justify-between pb-4 mb-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="btn-secondary flex items-center gap-1"
            >
              <CloseIcon className="h-4 w-4" />
              <span className="hidden md:inline">Close</span>
            </button>
          )}

          {/* Edit button - shown in active and archived views */}
          {view !== 'deleted' && onEdit && (
            <button
              onClick={onEdit}
              className="btn-primary flex items-center gap-2"
            >
              <EditIcon />
              <span className="hidden md:inline">Edit</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Archive button - shown in active view */}
          {view === 'active' && onArchive && (
            <button
              onClick={onArchive}
              className="btn-secondary flex items-center gap-2"
              title="Archive note"
            >
              <ArchiveIcon className="h-4 w-4" />
              <span className="hidden md:inline">Archive</span>
            </button>
          )}

          {/* Unarchive button - shown in archived view */}
          {view === 'archived' && onUnarchive && (
            <button
              onClick={onUnarchive}
              className="btn-secondary flex items-center gap-2"
              title="Restore note"
            >
              <RestoreIcon />
              <span className="hidden md:inline">Restore</span>
            </button>
          )}

          {/* Restore button - shown in deleted view */}
          {view === 'deleted' && onRestore && (
            <button
              onClick={onRestore}
              className="btn-primary flex items-center gap-2"
              title="Restore note"
            >
              <RestoreIcon />
              <span className="hidden md:inline">Restore</span>
            </button>
          )}

          {/* Delete button */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 flex items-center gap-2"
              title={view === 'deleted' ? 'Delete permanently' : 'Delete note'}
            >
              <TrashIcon />
              <span className="hidden md:inline">{view === 'deleted' ? 'Delete Permanently' : 'Delete'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable note content */}
      <article className="flex-1 overflow-y-auto min-h-0 pr-2 pt-2">
        {/* Title row - inline with metadata on desktop */}
        <div className="flex flex-col md:flex-row md:items-center md:gap-4 mb-2">
          <h1 className="text-2xl font-bold text-gray-900 shrink-0">
            {note.title}
          </h1>

          {/* Inline metadata */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 mt-1 md:mt-0">
            {note.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => onTagClick?.(tag)}
                className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                title={`Filter by tag: ${tag}`}
              >
                {tag}
              </button>
            ))}
            {note.tags.length > 0 && <span className="text-gray-300">·</span>}
            <span>Created {formatDate(note.created_at)}</span>
            {note.updated_at !== note.created_at && (
              <>
                <span className="text-gray-300">·</span>
                <span>Updated {formatDate(note.updated_at)}</span>
              </>
            )}
            {note.version > 1 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">v{note.version}</span>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {note.description && (
          <p className="text-sm text-gray-600 italic mb-3">
            {note.description}
          </p>
        )}

        {/* Divider */}
        <div className="border-t border-gray-200 mt-8" />

        {/* Markdown content */}
        <div className="pt-10">
          <MarkdownViewer content={note.content} emptyText="No content" />
        </div>
      </article>
    </div>
  )
}
