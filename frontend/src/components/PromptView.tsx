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
      <article className="flex-1 overflow-y-auto min-h-0 pr-2 pt-2">
        {/* Title row - inline with metadata on desktop */}
        <div className="flex flex-col md:flex-row md:items-center md:gap-4 mb-2">
          <div className="shrink-0">
            <h1 className="text-2xl font-bold text-gray-900">
              {displayName}
            </h1>
            {prompt.title && prompt.title !== prompt.name && (
              <p className="text-sm text-gray-500 font-mono">
                {prompt.name}
              </p>
            )}
          </div>

          {/* Inline metadata */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 mt-1 md:mt-0">
            {prompt.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => onTagClick?.(tag)}
                className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                title={`Filter by tag: ${tag}`}
              >
                {tag}
              </button>
            ))}
            {prompt.tags.length > 0 && <span className="text-gray-300">·</span>}
            <span>Created {formatDate(prompt.created_at)}</span>
            {prompt.updated_at !== prompt.created_at && (
              <>
                <span className="text-gray-300">·</span>
                <span>Updated {formatDate(prompt.updated_at)}</span>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {prompt.description && (
          <p className="text-sm text-gray-600 italic mb-3">
            {prompt.description}
          </p>
        )}

        {/* Arguments - compact list */}
        {hasArguments && (
          <div className="mb-5">
            <span className="text-sm text-gray-500">Arguments:</span>
            <div className="space-y-2 mt-2">
              {requiredArgs.map((arg) => (
                <div key={arg.name} className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-purple-700 bg-purple-50 px-2 py-1 rounded text-sm">
                    {arg.name}
                  </code>
                  <span className="text-sm text-red-600">(required)</span>
                  {arg.description && (
                    <span className="text-gray-600 text-sm">— {arg.description}</span>
                  )}
                </div>
              ))}
              {optionalArgs.map((arg) => (
                <div key={arg.name} className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded text-sm">
                    {arg.name}
                  </code>
                  <span className="text-sm text-gray-400">(optional)</span>
                  {arg.description && (
                    <span className="text-gray-600 text-sm">— {arg.description}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-200 mt-8" />

        {/* Template content */}
        <div className="pt-10">
          <MarkdownViewer content={prompt.content} emptyText="No template content" />
        </div>
      </article>
    </div>
  )
}
