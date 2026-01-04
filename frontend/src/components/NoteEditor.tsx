/**
 * Component for editing note content with CodeMirror markdown editor.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { TagInput } from './TagInput'
import type { TagInputHandle } from './TagInput'
import { MarkdownEditor } from './MarkdownEditor'
import type { Note, NoteCreate, NoteUpdate, TagCount } from '../types'
import { TAG_PATTERN } from '../utils'
import { config } from '../config'
import { ArchiveIcon, TrashIcon } from './icons'

/** Key prefix for localStorage draft storage */
const DRAFT_KEY_PREFIX = 'note_draft_'

interface DraftData {
  title: string
  description: string
  content: string
  tags: string[]
  savedAt: number
}

interface NoteEditorProps {
  /** Existing note when editing, undefined when creating */
  note?: Note
  /** Available tags for autocomplete */
  tagSuggestions: TagCount[]
  /** Called when form is submitted */
  onSubmit: (data: NoteCreate | NoteUpdate) => Promise<void>
  /** Called when user cancels */
  onCancel: () => void
  /** Whether the form is being submitted */
  isSubmitting?: boolean
  /** Initial tags to populate (e.g., from current list filter) */
  initialTags?: string[]
  /** Called when note is archived (shown in header when provided) */
  onArchive?: () => void
  /** Called when note is deleted (shown in header when provided) */
  onDelete?: () => void
}

interface FormState {
  title: string
  description: string
  content: string
  tags: string[]
}

interface FormErrors {
  title?: string
  description?: string
  content?: string
  tags?: string
  general?: string
}

/**
 * Get the localStorage key for a note draft.
 */
function getDraftKey(noteId?: number): string {
  return noteId ? `${DRAFT_KEY_PREFIX}${noteId}` : `${DRAFT_KEY_PREFIX}new`
}

/**
 * Load draft from localStorage if available.
 */
function loadDraft(noteId?: number): DraftData | null {
  try {
    const key = getDraftKey(noteId)
    const stored = localStorage.getItem(key)
    if (stored) {
      return JSON.parse(stored) as DraftData
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

/**
 * Save draft to localStorage.
 */
function saveDraft(noteId: number | undefined, data: DraftData): void {
  try {
    const key = getDraftKey(noteId)
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

/**
 * Clear draft from localStorage.
 */
function clearDraft(noteId?: number): void {
  try {
    const key = getDraftKey(noteId)
    localStorage.removeItem(key)
  } catch {
    // Ignore errors
  }
}

/**
 * NoteEditor provides a form for creating or editing notes.
 *
 * Features:
 * - CodeMirror editor with markdown syntax highlighting
 * - Title and description inputs
 * - Tag input with autocomplete
 * - Preview mode toggle
 * - Draft autosave to localStorage (every 30 seconds)
 * - Keyboard shortcuts: Cmd+S to save, Esc to cancel
 */
export function NoteEditor({
  note,
  tagSuggestions,
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialTags,
  onArchive,
  onDelete,
}: NoteEditorProps): ReactNode {
  const isEditing = !!note

  const [form, setForm] = useState<FormState>({
    title: note?.title || '',
    description: note?.description || '',
    content: note?.content || '',
    tags: note?.tags || initialTags || [],
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const cancelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check for existing draft on mount - compute initial value with initializer function
  const [hasDraft, setHasDraft] = useState(() => {
    const draft = loadDraft(note?.id)
    if (!draft) return false

    // Only show prompt if draft is different from current note
    const isDifferent = isEditing
      ? draft.title !== note?.title ||
        draft.description !== (note?.description || '') ||
        draft.content !== (note?.content || '') ||
        JSON.stringify(draft.tags) !== JSON.stringify(note?.tags || [])
      : draft.title || draft.description || draft.content || draft.tags.length > 0

    return Boolean(isDifferent)
  })

  // Track if form has unsaved changes (for draft saving)
  const isDirty =
    form.title !== (note?.title || '') ||
    form.description !== (note?.description || '') ||
    form.content !== (note?.content || '') ||
    JSON.stringify(form.tags) !== JSON.stringify(note?.tags || initialTags || [])

  const tagInputRef = useRef<TagInputHandle>(null)
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Auto-save draft every 30 seconds, but only when form has changes
  useEffect(() => {
    if (!isDirty) {
      // No changes to save - clear any existing timer
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
        draftTimerRef.current = null
      }
      return
    }

    draftTimerRef.current = setInterval(() => {
      const draftData: DraftData = {
        title: form.title,
        description: form.description,
        content: form.content,
        tags: form.tags,
        savedAt: Date.now(),
      }
      saveDraft(note?.id, draftData)
    }, 30000)

    return () => {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
      }
    }
  }, [form, note?.id, isDirty])

  // Handle cancel with confirmation if dirty
  const handleCancelRequest = useCallback((): void => {
    // Clear any existing timeout
    if (cancelTimeoutRef.current) {
      clearTimeout(cancelTimeoutRef.current)
      cancelTimeoutRef.current = null
    }

    if (!isDirty) {
      // No changes, just cancel
      onCancel()
      return
    }

    if (confirmingCancel) {
      // Already confirming, execute cancel
      onCancel()
    } else {
      // Start confirmation
      setConfirmingCancel(true)
      // Auto-reset after 3 seconds
      cancelTimeoutRef.current = setTimeout(() => {
        setConfirmingCancel(false)
      }, 3000)
    }
  }, [isDirty, confirmingCancel, onCancel])

  // Cleanup cancel timeout on unmount
  useEffect(() => {
    return () => {
      if (cancelTimeoutRef.current) {
        clearTimeout(cancelTimeoutRef.current)
      }
    }
  }, [])

  // Reset cancel confirmation state
  const resetCancelConfirmation = useCallback((): void => {
    if (cancelTimeoutRef.current) {
      clearTimeout(cancelTimeoutRef.current)
      cancelTimeoutRef.current = null
    }
    setConfirmingCancel(false)
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Cmd+S or Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        formRef.current?.requestSubmit()
      }
      // When confirming cancel: Escape backs out, Enter confirms discard
      if (confirmingCancel) {
        if (e.key === 'Escape') {
          e.preventDefault()
          resetCancelConfirmation()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          onCancel()
        }
        return
      }
      // Escape to start cancel (with confirmation if dirty)
      if (e.key === 'Escape') {
        handleCancelRequest()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCancelRequest, confirmingCancel, resetCancelConfirmation, onCancel])

  const restoreDraft = useCallback((): void => {
    const draft = loadDraft(note?.id)
    if (draft) {
      setForm({
        title: draft.title,
        description: draft.description,
        content: draft.content,
        tags: draft.tags,
      })
    }
    setHasDraft(false)
  }, [note?.id])

  const discardDraft = useCallback((): void => {
    clearDraft(note?.id)
    setHasDraft(false)
  }, [note?.id])

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    // Title is required for notes
    if (!form.title.trim()) {
      newErrors.title = 'Title is required'
    } else if (form.title.length > config.limits.maxTitleLength) {
      newErrors.title = `Title exceeds ${config.limits.maxTitleLength.toLocaleString()} characters`
    }

    if (form.description.length > config.limits.maxDescriptionLength) {
      newErrors.description = `Description exceeds ${config.limits.maxDescriptionLength.toLocaleString()} characters`
    }

    if (form.content.length > config.limits.maxNoteContentLength) {
      newErrors.content = `Content exceeds ${config.limits.maxNoteContentLength.toLocaleString()} characters`
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()

    if (!validate()) return

    // Get any pending tag text and include it
    const pendingTag = tagInputRef.current?.getPendingValue() || ''
    const tagsToSubmit = [...form.tags]
    if (pendingTag) {
      const normalized = pendingTag.toLowerCase().trim()
      // Only add if valid and not already present
      if (TAG_PATTERN.test(normalized) && !tagsToSubmit.includes(normalized)) {
        tagsToSubmit.push(normalized)
        tagInputRef.current?.clearPending()
      }
    }

    try {
      if (isEditing) {
        // For updates, only send changed fields
        const updates: NoteUpdate = {}
        if (form.title !== note?.title) updates.title = form.title
        if (form.description !== (note?.description || ''))
          updates.description = form.description || null
        if (form.content !== (note?.content || ''))
          updates.content = form.content || null
        if (JSON.stringify(tagsToSubmit) !== JSON.stringify(note?.tags || []))
          updates.tags = tagsToSubmit

        await onSubmit(updates)
      } else {
        // For creates, send all data
        const createData: NoteCreate = {
          title: form.title,
          description: form.description || undefined,
          content: form.content || undefined,
          tags: tagsToSubmit,
        }
        await onSubmit(createData)
      }

      // Clear draft on successful save
      clearDraft(note?.id)
    } catch {
      // Error handling is done in the parent component
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col h-full">
      {/* Fixed header with action buttons */}
      <div className="shrink-0 bg-white flex items-center justify-between pb-4 mb-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancelRequest}
            disabled={isSubmitting}
            className={confirmingCancel
              ? "btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 bg-red-50"
              : "btn-secondary"
            }
          >
            {confirmingCancel ? 'Discard changes?' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !form.title.trim()}
            className="btn-primary"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-1.5">
                <div className="spinner-sm" />
                Saving...
              </span>
            ) : isEditing ? (
              'Save Changes'
            ) : (
              'Create Note'
            )}
          </button>
          <span className="text-xs text-gray-400 ml-2 flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">⌘S</kbd>
            <kbd className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">Esc</kbd>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isSubmitting}
              className="btn-secondary flex items-center gap-2"
              title="Archive note"
            >
              <ArchiveIcon className="h-4 w-4" />
              Archive
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isSubmitting}
              className="btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 flex items-center gap-2"
              title="Delete note"
            >
              <TrashIcon />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Scrollable form content */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-6 pr-2">
        {/* Draft restoration prompt */}
        {hasDraft && (
        <div className="alert-info flex items-center justify-between">
          <p className="text-sm">
            You have an unsaved draft from a previous session.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={restoreDraft}
              className="btn-secondary text-sm py-1 px-3"
            >
              Restore Draft
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="btn-secondary text-sm py-1 px-3"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* General error */}
      {errors.general && (
        <div className="alert-warning">
          <p className="text-sm">{errors.general}</p>
        </div>
      )}

      {/* Title and Tags row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Title field - required (2/3 width on desktop) */}
        <div className="md:col-span-2">
          <label htmlFor="title" className="label">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="title"
            value={form.title}
            onChange={(e) => {
              setForm((prev) => ({ ...prev, title: e.target.value }))
              if (errors.title) {
                setErrors((prev) => ({ ...prev, title: undefined }))
              }
            }}
            placeholder="Note title"
            disabled={isSubmitting}
            maxLength={config.limits.maxTitleLength}
            className={`input mt-1 ${errors.title ? 'input-error' : ''}`}
            autoFocus
          />
          {errors.title && <p className="error-text">{errors.title}</p>}
        </div>

        {/* Tags field (1/3 width on desktop) */}
        <div>
          <label htmlFor="tags" className="label">
            Tags
          </label>
          <div className="mt-1">
            <TagInput
              ref={tagInputRef}
              id="tags"
              value={form.tags}
              onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
              suggestions={tagSuggestions}
              placeholder="Add tags..."
              disabled={isSubmitting}
              error={errors.tags}
            />
          </div>
        </div>
      </div>

      {/* Description field - optional */}
      <div>
        <label htmlFor="description" className="label">
          Description
        </label>
        <textarea
          id="description"
          value={form.description}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, description: e.target.value }))
          }
          placeholder="Brief summary or metadata..."
          rows={2}
          disabled={isSubmitting}
          maxLength={config.limits.maxDescriptionLength}
          className={`input mt-1 ${errors.description ? 'input-error' : ''}`}
        />
        <div className="flex justify-between items-center">
          {errors.description ? (
            <p className="error-text">{errors.description}</p>
          ) : (
            <span />
          )}
          <span className="helper-text">
            {form.description.length.toLocaleString()}/{config.limits.maxDescriptionLength.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Content field with preview toggle */}
      <MarkdownEditor
        value={form.content}
        onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
        disabled={isSubmitting}
        hasError={!!errors.content}
        minHeight="200px"
        label="Content"
        maxLength={config.limits.maxNoteContentLength}
        errorMessage={errors.content}
      />
      </div>
    </form>
  )
}
