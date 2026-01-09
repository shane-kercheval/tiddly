/**
 * Unified Note component for viewing and editing notes.
 *
 * Replaces separate NoteView and NoteEditor components with a single
 * always-editable experience using inline editable components.
 *
 * Features:
 * - Inline editable title, tags, description
 * - ContentEditor with Visual/Markdown toggle
 * - Save/Discard buttons appear when dirty
 * - Draft auto-save to localStorage for recovery
 * - Keyboard shortcuts: Cmd+S to save, Escape to cancel
 * - beforeunload warning when dirty
 * - Read-only mode for deleted items
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { InlineEditableTitle } from './InlineEditableTitle'
import { InlineEditableTags, type InlineEditableTagsHandle } from './InlineEditableTags'
import { InlineEditableText } from './InlineEditableText'
import { ContentEditor } from './ContentEditor'
import { UnsavedChangesDialog } from './ui'
import { ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon, CheckIcon } from './icons'
import { formatDate } from '../utils'
import { TAG_PATTERN } from '../utils'
import { config } from '../config'
import { cleanMarkdown } from '../utils/cleanMarkdown'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import type { Note as NoteType, NoteCreate, NoteUpdate, TagCount } from '../types'

/** Key prefix for localStorage draft storage */
const DRAFT_KEY_PREFIX = 'note_draft_'

/** Draft data structure stored in localStorage */
interface DraftData {
  title: string
  description: string
  content: string
  tags: string[]
  savedAt: number
}

/** Form state for the note */
interface NoteState {
  title: string
  description: string
  content: string
  tags: string[]
}

/** Validation errors */
interface FormErrors {
  title?: string
  description?: string
  content?: string
}

interface NoteProps {
  /** Existing note when editing, undefined when creating */
  note?: NoteType
  /** Available tags for autocomplete */
  tagSuggestions: TagCount[]
  /** Called when note is saved */
  onSave: (data: NoteCreate | NoteUpdate) => Promise<void>
  /** Called when user closes/cancels */
  onClose: () => void
  /** Whether a save is in progress */
  isSaving?: boolean
  /** Initial tags to populate (e.g., from current list filter) */
  initialTags?: string[]
  /** Called when note is archived */
  onArchive?: () => void
  /** Called when note is unarchived */
  onUnarchive?: () => void
  /** Called when note is deleted */
  onDelete?: () => void
  /** Called when note is restored from trash */
  onRestore?: () => void
  /** View state for conditional action buttons */
  viewState?: 'active' | 'archived' | 'deleted'
  /** Whether to use full width layout */
  fullWidth?: boolean
}

/**
 * Get the localStorage key for a note draft.
 */
function getDraftKey(noteId?: string): string {
  return noteId ? `${DRAFT_KEY_PREFIX}${noteId}` : `${DRAFT_KEY_PREFIX}new`
}

/**
 * Load draft from localStorage if available.
 */
function loadDraft(noteId?: string): DraftData | null {
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
function saveDraft(noteId: string | undefined, data: DraftData): void {
  try {
    const key = getDraftKey(noteId)
    localStorage.setItem(key, JSON.stringify(data))
  } catch (error) {
    // Log in development mode so developers know drafts aren't saving
    if (import.meta.env.DEV) {
      console.warn('Failed to save draft to localStorage:', error)
    }
  }
}

/**
 * Clear draft from localStorage.
 */
function clearDraft(noteId?: string): void {
  try {
    const key = getDraftKey(noteId)
    localStorage.removeItem(key)
  } catch {
    // Ignore errors
  }
}

/**
 * Note provides a unified view/edit experience for notes.
 */
export function Note({
  note,
  tagSuggestions,
  onSave,
  onClose,
  isSaving = false,
  initialTags,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  viewState = 'active',
  fullWidth = false,
}: NoteProps): ReactNode {
  const isCreate = !note

  // Initialize state from note or defaults
  // Note: useState only calls the initializer once, so useCallback would be unnecessary here
  // Clean content on initialization to match what Milkdown will output, preventing false dirty state
  const getInitialState = (): NoteState => ({
    title: note?.title ?? '',
    description: note?.description ?? '',
    content: cleanMarkdown(note?.content ?? ''),
    tags: note?.tags ?? initialTags ?? [],
  })

  const [original, setOriginal] = useState<NoteState>(getInitialState)
  const [current, setCurrent] = useState<NoteState>(getInitialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [contentKey, setContentKey] = useState(0) // Force editor remount when content is restored

  // Cancel confirmation state
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const discardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Draft recovery state - compute on mount
  const [hasDraft, setHasDraft] = useState(() => {
    const draft = loadDraft(note?.id)
    if (!draft) return false

    // Only show prompt if draft is different from current note
    const isDifferent = note
      ? draft.title !== note.title ||
        draft.description !== (note.description ?? '') ||
        draft.content !== (note.content ?? '') ||
        JSON.stringify(draft.tags) !== JSON.stringify(note.tags ?? [])
      : draft.title || draft.description || draft.content || draft.tags.length > 0

    return Boolean(isDifferent)
  })

  // Refs
  const tagInputRef = useRef<InlineEditableTagsHandle>(null)
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Read-only mode for deleted notes
  const isReadOnly = viewState === 'deleted'

  // Compute dirty state - optimized to avoid deep comparison overhead
  // Check lengths first for quick short-circuit on large content
  const isDirty = useMemo(
    () =>
      current.title !== original.title ||
      current.description !== original.description ||
      current.content.length !== original.content.length ||
      current.content !== original.content ||
      current.tags.length !== original.tags.length ||
      current.tags.some((tag, i) => tag !== original.tags[i]),
    [current, original]
  )

  // Compute validity for save button (doesn't show error messages, just checks if saveable)
  const isValid = useMemo(
    () =>
      current.title.trim().length > 0 &&
      current.title.length <= config.limits.maxTitleLength &&
      current.description.length <= config.limits.maxDescriptionLength &&
      current.content.length <= config.limits.maxNoteContentLength,
    [current.title, current.description, current.content]
  )

  // Can save when form is dirty and valid
  const canSave = isDirty && isValid

  // Navigation blocking when dirty
  const { showDialog, handleStay, handleLeave, confirmLeave } = useUnsavedChangesWarning(isDirty)

  // Auto-focus title for new notes only
  useEffect(() => {
    if (isCreate && titleInputRef.current) {
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        titleInputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isCreate])

  // Auto-save draft every 30 seconds when dirty
  useEffect(() => {
    if (!isDirty || isReadOnly) {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
        draftTimerRef.current = null
      }
      return
    }

    draftTimerRef.current = setInterval(() => {
      const draftData: DraftData = {
        title: current.title,
        description: current.description,
        content: current.content,
        tags: current.tags,
        savedAt: Date.now(),
      }
      saveDraft(note?.id, draftData)
    }, 30000)

    return () => {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
      }
    }
  }, [current, note?.id, isDirty, isReadOnly])

  // beforeunload handler for navigation warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome to show the dialog
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Handle discard with confirmation
  const handleDiscardRequest = useCallback((): void => {
    // Clear any existing timeout
    if (discardTimeoutRef.current) {
      clearTimeout(discardTimeoutRef.current)
      discardTimeoutRef.current = null
    }

    if (!isDirty) {
      onClose()
      return
    }

    if (confirmingDiscard) {
      // Already confirming, execute discard
      clearDraft(note?.id) // Clear autosaved draft when user explicitly discards
      confirmLeave() // Prevent navigation blocker from showing
      onClose()
    } else {
      // Start confirmation
      setConfirmingDiscard(true)
      // Auto-reset after 3 seconds
      discardTimeoutRef.current = setTimeout(() => {
        setConfirmingDiscard(false)
      }, 3000)
    }
  }, [isDirty, confirmingDiscard, onClose, note?.id, confirmLeave])

  // Cleanup discard timeout on unmount
  useEffect(() => {
    return () => {
      if (discardTimeoutRef.current) {
        clearTimeout(discardTimeoutRef.current)
      }
    }
  }, [])

  // Reset discard confirmation
  const resetDiscardConfirmation = useCallback((): void => {
    if (discardTimeoutRef.current) {
      clearTimeout(discardTimeoutRef.current)
      discardTimeoutRef.current = null
    }
    setConfirmingDiscard(false)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Cmd+S or Ctrl+S to save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!isReadOnly) {
          formRef.current?.requestSubmit()
        }
      }

      // When confirming discard: Escape backs out, Enter confirms
      if (confirmingDiscard) {
        if (e.key === 'Escape') {
          e.preventDefault()
          resetDiscardConfirmation()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          onClose()
        }
        return
      }

      // Escape to start discard (with confirmation if dirty)
      if (e.key === 'Escape') {
        handleDiscardRequest()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleDiscardRequest, confirmingDiscard, resetDiscardConfirmation, onClose, isReadOnly])

  // Draft restoration
  const restoreDraft = useCallback((): void => {
    const draft = loadDraft(note?.id)
    if (draft) {
      setCurrent({
        title: draft.title,
        description: draft.description,
        content: draft.content,
        tags: draft.tags,
      })
      // Force editor remount to display restored content
      setContentKey((prev) => prev + 1)
    }
    setHasDraft(false)
  }, [note?.id])

  const discardDraft = useCallback((): void => {
    clearDraft(note?.id)
    setHasDraft(false)
  }, [note?.id])

  // Validation
  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!current.title.trim()) {
      newErrors.title = 'Title is required'
    } else if (current.title.length > config.limits.maxTitleLength) {
      newErrors.title = `Title exceeds ${config.limits.maxTitleLength.toLocaleString()} characters`
    }

    if (current.description.length > config.limits.maxDescriptionLength) {
      newErrors.description = `Description exceeds ${config.limits.maxDescriptionLength.toLocaleString()} characters`
    }

    if (current.content.length > config.limits.maxNoteContentLength) {
      newErrors.content = `Content exceeds ${config.limits.maxNoteContentLength.toLocaleString()} characters`
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Submit handler
  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()

    if (isReadOnly || !validate()) return

    // Get any pending tag text and include it
    const pendingTag = tagInputRef.current?.getPendingValue() ?? ''
    const tagsToSubmit = [...current.tags]
    if (pendingTag) {
      const normalized = pendingTag.toLowerCase().trim()
      if (TAG_PATTERN.test(normalized) && !tagsToSubmit.includes(normalized)) {
        tagsToSubmit.push(normalized)
        tagInputRef.current?.clearPending()
      }
    }

    try {
      if (isCreate) {
        const createData: NoteCreate = {
          title: current.title,
          description: current.description || undefined,
          content: current.content || undefined,
          tags: tagsToSubmit,
        }
        // For creates, onSave navigates away - prevent blocker from showing
        confirmLeave()
        await onSave(createData)
      } else {
        // For updates, only send changed fields
        const updates: NoteUpdate = {}
        if (current.title !== note?.title) updates.title = current.title
        if (current.description !== (note?.description ?? '')) {
          updates.description = current.description || null
        }
        if (current.content !== (note?.content ?? '')) {
          updates.content = current.content || null
        }
        if (JSON.stringify(tagsToSubmit) !== JSON.stringify(note?.tags ?? [])) {
          updates.tags = tagsToSubmit
        }

        await onSave(updates)
      }

      // Clear draft on successful save
      clearDraft(note?.id)

      // Update original to match current (form is now clean)
      setOriginal({ ...current, tags: tagsToSubmit })
    } catch {
      // Error handling is done in the parent component
    }
  }

  // Update handlers - memoized to prevent unnecessary child re-renders
  const handleTitleChange = useCallback((title: string): void => {
    setCurrent((prev) => ({ ...prev, title }))
    setErrors((prev) => (prev.title ? { ...prev, title: undefined } : prev))
  }, [])

  const handleDescriptionChange = useCallback((description: string): void => {
    setCurrent((prev) => ({ ...prev, description }))
    setErrors((prev) => (prev.description ? { ...prev, description: undefined } : prev))
  }, [])

  const handleContentChange = useCallback((content: string): void => {
    setCurrent((prev) => ({ ...prev, content }))
    setErrors((prev) => (prev.content ? { ...prev, content: undefined } : prev))
  }, [])

  const handleTagsChange = useCallback((tags: string[]): void => {
    setCurrent((prev) => ({ ...prev, tags }))
  }, [])

  // Prevent form submission on Enter in inputs
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className={`flex flex-col h-full w-full ${fullWidth ? '' : 'max-w-4xl'}`}
    >
      {/* Fixed header with action buttons */}
      <div className="shrink-0 bg-white flex items-center justify-between pb-4 mb-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {/* Cancel button */}
          <button
            type="button"
            onClick={handleDiscardRequest}
            disabled={isSaving}
            className={`flex items-center gap-1.5 ${
              confirmingDiscard
                ? 'btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 bg-red-50'
                : 'btn-secondary'
            }`}
          >
            <CloseIcon className="h-4 w-4" />
            {confirmingDiscard ? (
              <span>Discard?</span>
            ) : (
              <span className="hidden md:inline">Cancel</span>
            )}
          </button>

          {/* Create/Save button - enabled when dirty and valid */}
          {!isReadOnly && (
            <button
              type="submit"
              disabled={isSaving || !canSave}
              className="btn-primary flex items-center gap-1.5"
            >
              {isSaving ? (
                <>
                  <div className="spinner-sm" />
                  <span className="hidden md:inline">Saving...</span>
                </>
              ) : (
                <>
                  <CheckIcon className="h-4 w-4" />
                  <span className="hidden md:inline">{isCreate ? 'Create' : 'Save'}</span>
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Archive button - active notes only */}
          {viewState === 'active' && onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isSaving}
              className="btn-secondary flex items-center gap-2"
              title="Archive note"
            >
              <ArchiveIcon className="h-4 w-4" />
              <span className="hidden md:inline">Archive</span>
            </button>
          )}

          {/* Unarchive button - archived notes only */}
          {viewState === 'archived' && onUnarchive && (
            <button
              type="button"
              onClick={onUnarchive}
              disabled={isSaving}
              className="btn-secondary flex items-center gap-2"
              title="Restore note"
            >
              <RestoreIcon />
              <span className="hidden md:inline">Restore</span>
            </button>
          )}

          {/* Restore button - deleted notes only */}
          {viewState === 'deleted' && onRestore && (
            <button
              type="button"
              onClick={onRestore}
              disabled={isSaving}
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
              type="button"
              onClick={onDelete}
              disabled={isSaving}
              className="btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 flex items-center gap-2"
              title={viewState === 'deleted' ? 'Delete permanently' : 'Delete note'}
            >
              <TrashIcon />
              <span className="hidden md:inline">
                {viewState === 'deleted' ? 'Delete Permanently' : 'Delete'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content - padding with negative margin gives room for focus rings to show */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-2 pl-2 -ml-2 pt-1 -mt-1">
        {/* Header section: drafts, banners, title, description, metadata */}
        <div className="space-y-4">
          {/* Draft restoration prompt */}
          {hasDraft && !isReadOnly && (
            <div className="alert-info flex items-center justify-between">
              <p className="text-sm">You have an unsaved draft from a previous session.</p>
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

          {/* Read-only banner for deleted notes */}
          {isReadOnly && (
            <div className="alert-warning">
              <p className="text-sm">This note is in trash and cannot be edited. Restore it to make changes.</p>
            </div>
          )}

          {/* Title */}
          <InlineEditableTitle
            ref={titleInputRef}
            value={current.title}
            onChange={handleTitleChange}
            placeholder="Note title"
            required
            disabled={isSaving || isReadOnly}
            error={errors.title}
          />

          {/* Description */}
          <InlineEditableText
            value={current.description}
            onChange={handleDescriptionChange}
            placeholder="Add a description..."
            disabled={isSaving || isReadOnly}
            maxLength={config.limits.maxDescriptionLength}
            error={errors.description}
          />

          {/* Metadata row: tags + timestamps */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
            <InlineEditableTags
              ref={tagInputRef}
              value={current.tags}
              onChange={handleTagsChange}
              suggestions={tagSuggestions}
              disabled={isSaving || isReadOnly}
            />
            {note && (
              <>
                <span className="text-gray-300">·</span>
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
                    <span>v{note.version}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Content editor */}
        <ContentEditor
          key={contentKey}
          value={current.content}
          onChange={handleContentChange}
          disabled={isSaving || isReadOnly}
          hasError={!!errors.content}
          minHeight="200px"
          placeholder="Write your note in markdown..."
          maxLength={config.limits.maxNoteContentLength}
          errorMessage={errors.content}
          label=""
          showBorder={true}
          subtleBorder={true}
        />
      </div>

      {/* Unsaved changes warning dialog */}
      <UnsavedChangesDialog
        isOpen={showDialog}
        onStay={handleStay}
        onLeave={handleLeave}
      />
    </form>
  )
}
