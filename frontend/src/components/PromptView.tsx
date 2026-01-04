/**
 * Component for viewing a prompt with its content and arguments.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { Prompt } from '../types'
import { formatDate } from '../utils'
import { EditIcon, ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon } from './icons'
import { MarkdownViewer } from './MarkdownEditor'

interface PromptViewProps {
  prompt: Prompt
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
 * PromptView displays a prompt with its content and arguments.
 *
 * Features:
 * - Shows name (unique identifier) and title (display name)
 * - Displays description and Jinja2 template content
 * - Lists all arguments with their types and descriptions
 * - Context-aware actions based on view state
 * - Keyboard shortcuts: 'e' to edit, Escape to close
 */
export function PromptView({
  prompt,
  view = 'active',
  fullWidth = false,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onTagClick,
  onBack,
}: PromptViewProps): ReactNode {
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

  const displayName = prompt.title || prompt.name
  const hasArguments = prompt.arguments.length > 0
  const requiredArgs = prompt.arguments.filter(arg => arg.required)
  const optionalArgs = prompt.arguments.filter(arg => !arg.required)

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
              Close
            </button>
          )}

          {/* Edit button - shown in active and archived views */}
          {view !== 'deleted' && onEdit && (
            <button
              onClick={onEdit}
              className="btn-primary flex items-center gap-2"
            >
              <EditIcon />
              Edit
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Archive button - shown in active view */}
          {view === 'active' && onArchive && (
            <button
              onClick={onArchive}
              className="btn-secondary flex items-center gap-2"
              title="Archive prompt"
            >
              <ArchiveIcon className="h-4 w-4" />
              Archive
            </button>
          )}

          {/* Unarchive button - shown in archived view */}
          {view === 'archived' && onUnarchive && (
            <button
              onClick={onUnarchive}
              className="btn-secondary flex items-center gap-2"
              title="Restore prompt"
            >
              <RestoreIcon />
              Restore
            </button>
          )}

          {/* Restore button - shown in deleted view */}
          {view === 'deleted' && onRestore && (
            <button
              onClick={onRestore}
              className="btn-primary flex items-center gap-2"
              title="Restore prompt"
            >
              <RestoreIcon />
              Restore
            </button>
          )}

          {/* Delete button */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 flex items-center gap-2"
              title={view === 'deleted' ? 'Delete permanently' : 'Delete prompt'}
            >
              <TrashIcon />
              {view === 'deleted' ? 'Delete Permanently' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable prompt content */}
      <article className="flex-1 overflow-y-auto min-h-0 pr-2">
        {/* Title and name */}
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">
            {displayName}
          </h1>
          {prompt.title && prompt.title !== prompt.name && (
            <p className="text-sm text-gray-500 font-mono mt-1">
              {prompt.name}
            </p>
          )}
        </div>

        {/* Metadata card */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-6 space-y-4">
          {/* Tags */}
          {prompt.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {prompt.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onTagClick?.(tag)}
                  className="badge-secondary hover:bg-gray-100 hover:border-gray-300 transition-colors"
                  title={`Filter by tag: ${tag}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Dates */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Created {formatDate(prompt.created_at)}</span>
            {prompt.updated_at !== prompt.created_at && (
              <>
                <span className="text-gray-300">·</span>
                <span>Updated {formatDate(prompt.updated_at)}</span>
              </>
            )}
          </div>

          {/* Description */}
          {prompt.description && (
            <p className="text-gray-600 italic">
              {prompt.description}
            </p>
          )}

          {/* Arguments */}
          {hasArguments && (
            <div className="pt-2 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Arguments ({prompt.arguments.length})
              </h3>
              <div className="space-y-2">
                {/* Required arguments first */}
                {requiredArgs.map((arg) => (
                  <div key={arg.name} className="rounded border border-gray-200 p-2 bg-white">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                        {arg.name}
                      </code>
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">
                        required
                      </span>
                    </div>
                    {arg.description && (
                      <p className="text-sm text-gray-600 mt-1">{arg.description}</p>
                    )}
                  </div>
                ))}
                {/* Optional arguments */}
                {optionalArgs.map((arg) => (
                  <div key={arg.name} className="rounded border border-gray-200 p-2 bg-white">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                        {arg.name}
                      </code>
                      <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                        optional
                      </span>
                    </div>
                    {arg.description && (
                      <p className="text-sm text-gray-600 mt-1">{arg.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Template content */}
        <MarkdownViewer content={prompt.content} emptyText="No template content" />
      </article>
    </div>
  )
}
