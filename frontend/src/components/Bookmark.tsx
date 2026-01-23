/**
 * Unified Bookmark component for viewing and editing bookmarks.
 *
 * Replaces separate BookmarkForm with a unified always-editable experience
 * using inline editable components.
 *
 * Features:
 * - Inline editable URL (monospace), title, tags, description
 * - Archive scheduling with inline editing
 * - ContentEditor with Markdown/Text toggle for content
 * - Save/Discard buttons appear when dirty
 * - Keyboard shortcuts: Cmd+S to save, Escape to cancel
 * - beforeunload warning when dirty
 * - Fetch metadata functionality
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { InlineEditableUrl } from './InlineEditableUrl'
import { InlineEditableTitle } from './InlineEditableTitle'
import { InlineEditableTags, type InlineEditableTagsHandle } from './InlineEditableTags'
import { InlineEditableText } from './InlineEditableText'
import { InlineEditableArchiveSchedule } from './InlineEditableArchiveSchedule'
import { ContentEditor } from './ContentEditor'
import { UnsavedChangesDialog, StaleDialog, DeletedDialog } from './ui'
import { SaveOverlay } from './ui/SaveOverlay'
import { ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon, CheckIcon } from './icons'
import { formatDate, normalizeUrl, isValidUrl, TAG_PATTERN } from '../utils'
import { config } from '../config'
import { useDiscardConfirmation } from '../hooks/useDiscardConfirmation'
import { useSaveAndClose } from '../hooks/useSaveAndClose'
import { useStaleCheck } from '../hooks/useStaleCheck'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { useBookmarks } from '../hooks/useBookmarks'
import type { Bookmark as BookmarkType, BookmarkCreate, BookmarkUpdate, TagCount } from '../types'
import type { ArchivePreset } from '../utils'

/** Form state for the bookmark */
interface BookmarkState {
  url: string
  title: string
  description: string
  content: string
  tags: string[]
  archivedAt: string
  archivePreset: ArchivePreset
}

/** Validation errors */
interface FormErrors {
  url?: string
  title?: string
  description?: string
  content?: string
  general?: string
}

interface BookmarkProps {
  /** Existing bookmark when editing, undefined when creating */
  bookmark?: BookmarkType
  /** Available tags for autocomplete */
  tagSuggestions: TagCount[]
  /** Called when bookmark is saved */
  onSave: (data: BookmarkCreate | BookmarkUpdate) => Promise<void>
  /** Called when user closes/cancels */
  onClose: () => void
  /** Whether a save is in progress */
  isSaving?: boolean
  /** Initial URL to populate (e.g., from paste) */
  initialUrl?: string
  /** Initial tags to populate (e.g., from current list filter) */
  initialTags?: string[]
  /** Function to fetch metadata for a URL */
  onFetchMetadata?: (url: string) => Promise<{
    title: string | null
    description: string | null
    content: string | null
    error: string | null
  }>
  /** Called when bookmark is archived */
  onArchive?: () => void
  /** Called when bookmark is unarchived */
  onUnarchive?: () => void
  /** Called when bookmark is deleted */
  onDelete?: () => void
  /** Called when bookmark is restored from trash */
  onRestore?: () => void
  /** View state for conditional action buttons */
  viewState?: 'active' | 'archived' | 'deleted'
  /** Whether to use full width layout */
  fullWidth?: boolean
  /** Called to refresh the bookmark from server (for stale check) */
  onRefresh?: () => Promise<void>
}

/**
 * Get initial archive state from existing bookmark.
 */
function getInitialArchiveState(bookmark?: BookmarkType): { archivedAt: string; archivePreset: ArchivePreset } {
  if (!bookmark?.archived_at) {
    return { archivedAt: '', archivePreset: 'none' }
  }
  // If there's an existing date, set to custom so user can see/edit it
  return { archivedAt: bookmark.archived_at, archivePreset: 'custom' }
}

/**
 * Bookmark provides a unified view/edit experience for bookmarks.
 */
export function Bookmark({
  bookmark,
  tagSuggestions,
  onSave,
  onClose,
  isSaving = false,
  initialUrl,
  initialTags,
  onFetchMetadata,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  viewState = 'active',
  fullWidth = false,
  onRefresh,
}: BookmarkProps): ReactNode {
  const isCreate = !bookmark

  // Stale check hook
  const { fetchBookmarkMetadata } = useBookmarks()
  const { isStale, isDeleted, serverUpdatedAt, dismiss: dismissStale } = useStaleCheck({
    entityId: bookmark?.id,
    loadedUpdatedAt: bookmark?.updated_at,
    fetchUpdatedAt: async (id) => {
      const metadata = await fetchBookmarkMetadata(id)
      return metadata.updated_at
    },
  })

  // Initialize state from bookmark or defaults
  const getInitialState = (): BookmarkState => {
    const archiveState = getInitialArchiveState(bookmark)
    return {
      url: bookmark?.url ?? initialUrl ?? '',
      title: bookmark?.title ?? '',
      description: bookmark?.description ?? '',
      content: bookmark?.content ?? '',
      tags: bookmark?.tags ?? initialTags ?? [],
      archivedAt: archiveState.archivedAt,
      archivePreset: archiveState.archivePreset,
    }
  }

  const [original, setOriginal] = useState<BookmarkState>(getInitialState)
  const [current, setCurrent] = useState<BookmarkState>(getInitialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Metadata fetch state
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false)
  const [showFetchSuccess, setShowFetchSuccess] = useState(false)
  const [contentKey, setContentKey] = useState(0) // Force editor remount when content is fetched
  const autoFetchedRef = useRef<string | null>(null)
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs
  const tagInputRef = useRef<InlineEditableTagsHandle>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  // Track element to refocus after Cmd+S save (for CodeMirror which loses focus)
  const refocusAfterSaveRef = useRef<HTMLElement | null>(null)

  // Read-only mode for deleted bookmarks
  const isReadOnly = viewState === 'deleted'

  // Compute dirty state - optimized to avoid deep comparison overhead
  const isDirty = useMemo(
    () =>
      current.url !== original.url ||
      current.title !== original.title ||
      current.description !== original.description ||
      current.content.length !== original.content.length ||
      current.content !== original.content ||
      current.tags.length !== original.tags.length ||
      current.tags.some((tag, i) => tag !== original.tags[i]) ||
      current.archivedAt !== original.archivedAt,
    [current, original]
  )

  // Compute validity for save button
  const isValid = useMemo(() => {
    // URL is required for new bookmarks
    if (isCreate && !current.url.trim()) return false
    if (current.url.trim() && !isValidUrl(current.url)) return false
    if (current.title.length > config.limits.maxTitleLength) return false
    if (current.description.length > config.limits.maxDescriptionLength) return false
    if (current.content.length > config.limits.maxContentLength) return false
    return true
  }, [isCreate, current.url, current.title, current.description, current.content])

  // Can save when form is dirty and valid
  const canSave = isDirty && isValid

  // Navigation blocking when dirty
  const { showDialog, handleStay, handleLeave, confirmLeave } = useUnsavedChangesWarning(isDirty)

  // Discard confirmation (shows "Discard?" for 3 seconds on first click)
  const { isConfirming, requestDiscard, resetConfirmation } = useDiscardConfirmation({
    isDirty,
    onDiscard: onClose,
    onConfirmLeave: confirmLeave,
  })

  // Save and close (Cmd+Shift+S)
  const { requestSaveAndClose, checkAndClose, clearRequest: clearSaveAndClose } = useSaveAndClose({
    confirmLeave,
    onClose,
  })

  // Auto-focus URL for new bookmarks only (if no initialUrl)
  useEffect(() => {
    if (isCreate && !initialUrl && urlInputRef.current) {
      const timer = setTimeout(() => {
        urlInputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isCreate, initialUrl])

  // Auto-fetch metadata when initialUrl is provided
  useEffect(() => {
    if (
      initialUrl &&
      onFetchMetadata &&
      autoFetchedRef.current !== initialUrl &&
      isValidUrl(initialUrl)
    ) {
      autoFetchedRef.current = initialUrl
      setIsFetchingMetadata(true)
      setErrors({})

      onFetchMetadata(normalizeUrl(initialUrl))
        .then((metadata) => {
          if (metadata.error) {
            setErrors((prev) => ({
              ...prev,
              general: `Could not fetch metadata: ${metadata.error}`,
            }))
          }

          setCurrent((prev) => ({
            ...prev,
            title: metadata.title ?? '',
            description: metadata.description ?? '',
            content: metadata.content ?? '',
          }))

          // Force editor remount to display fetched content
          setContentKey((prev) => prev + 1)

          setShowFetchSuccess(true)
          if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current)
          }
          successTimeoutRef.current = setTimeout(() => setShowFetchSuccess(false), 2000)
        })
        .catch(() => {
          setErrors((prev) => ({
            ...prev,
            general: 'Failed to fetch metadata. You can still save the bookmark.',
          }))
        })
        .finally(() => {
          setIsFetchingMetadata(false)
        })
    }
  }, [initialUrl, onFetchMetadata])

  // Clean up any orphaned drafts from previous versions
  useEffect(() => {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('bookmark_draft_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  }, [])

  // beforeunload handler for navigation warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      // Only warn if dirty AND no modal is open
      if (isDirty && !isModalOpen) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome to show the dialog
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, isModalOpen])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current)
      }
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Cmd+Shift+S or Ctrl+Shift+S to save and close
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        if (!isReadOnly && isDirty) {
          requestSaveAndClose()
          formRef.current?.requestSubmit()
        }
        return
      }

      // Cmd+S or Ctrl+S to save (only if there are changes)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!isReadOnly && isDirty) {
          // Save active element to restore focus after save (CodeMirror loses focus during save)
          const activeElement = document.activeElement as HTMLElement | null
          if (activeElement?.closest('.cm-editor')) {
            refocusAfterSaveRef.current = activeElement
          }
          formRef.current?.requestSubmit()
        }
      }

      // When confirming discard: Escape backs out, Enter confirms
      if (isConfirming) {
        if (e.key === 'Escape') {
          e.preventDefault()
          resetConfirmation()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          confirmLeave() // Prevent navigation blocker from showing
          onClose()
        }
        return
      }

      // Escape to start discard (with confirmation if dirty)
      if (e.key === 'Escape') {
        requestDiscard()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestDiscard, isConfirming, resetConfirmation, onClose, isReadOnly, isDirty, confirmLeave, requestSaveAndClose])

  // Fetch metadata handler
  const handleFetchMetadata = useCallback(async (): Promise<void> => {
    if (!current.url.trim()) {
      setErrors((prev) => ({ ...prev, url: 'URL is required' }))
      return
    }

    if (!isValidUrl(current.url)) {
      setErrors((prev) => ({ ...prev, url: 'Please enter a valid URL' }))
      return
    }

    if (!onFetchMetadata) return

    setIsFetchingMetadata(true)
    setErrors({})

    try {
      const metadata = await onFetchMetadata(normalizeUrl(current.url))

      if (metadata.error) {
        setErrors((prev) => ({
          ...prev,
          general: `Could not fetch metadata: ${metadata.error}`,
        }))
      }

      setCurrent((prev) => ({
        ...prev,
        title: metadata.title ?? '',
        description: metadata.description ?? '',
        content: metadata.content ?? '',
      }))

      // Force editor remount to display fetched content
      setContentKey((prev) => prev + 1)

      setShowFetchSuccess(true)
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current)
      }
      successTimeoutRef.current = setTimeout(() => setShowFetchSuccess(false), 2000)
    } catch {
      setErrors((prev) => ({
        ...prev,
        general: 'Failed to fetch metadata. You can still save the bookmark.',
      }))
    } finally {
      setIsFetchingMetadata(false)
    }
  }, [current.url, onFetchMetadata])

  // Validation
  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (isCreate) {
      if (!current.url.trim()) {
        newErrors.url = 'URL is required'
      } else if (!isValidUrl(current.url)) {
        newErrors.url = 'Please enter a valid URL'
      }
    } else if (current.url.trim() && !isValidUrl(current.url)) {
      newErrors.url = 'Please enter a valid URL'
    }

    if (current.title.length > config.limits.maxTitleLength) {
      newErrors.title = `Title exceeds ${config.limits.maxTitleLength.toLocaleString()} characters`
    }

    if (current.description.length > config.limits.maxDescriptionLength) {
      newErrors.description = `Description exceeds ${config.limits.maxDescriptionLength.toLocaleString()} characters`
    }

    if (current.content.length > config.limits.maxContentLength) {
      newErrors.content = `Content exceeds ${config.limits.maxContentLength.toLocaleString()} characters`
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
        const createData: BookmarkCreate = {
          url: normalizeUrl(current.url),
          title: current.title || undefined,
          description: current.description || undefined,
          content: current.content || undefined,
          tags: tagsToSubmit,
          archived_at: current.archivedAt || undefined,
        }
        // For creates, onSave navigates away - prevent blocker from showing
        confirmLeave()
        await onSave(createData)
      } else {
        // For updates, only send changed fields
        const updates: BookmarkUpdate = {}
        const normalizedUrl = normalizeUrl(current.url)
        if (normalizedUrl !== bookmark?.url) updates.url = normalizedUrl
        if (current.title !== (bookmark?.title ?? '')) updates.title = current.title || null
        if (current.description !== (bookmark?.description ?? '')) {
          updates.description = current.description || null
        }
        if (current.content !== (bookmark?.content ?? '')) {
          updates.content = current.content || null
        }
        if (JSON.stringify(tagsToSubmit) !== JSON.stringify(bookmark?.tags ?? [])) {
          updates.tags = tagsToSubmit
        }
        // Include archived_at if changed
        const newArchivedAt = current.archivedAt || null
        const oldArchivedAt = bookmark?.archived_at || null
        if (newArchivedAt !== oldArchivedAt) {
          updates.archived_at = newArchivedAt
        }

        // Early return if nothing changed (safety net for edge cases)
        if (Object.keys(updates).length === 0) {
          return
        }

        await onSave(updates)
      }

      // Update original to match current (form is now clean)
      setOriginal({ ...current, tags: tagsToSubmit })

      // Close if requested (Cmd+Shift+S)
      if (checkAndClose()) return

      // Restore focus if we saved via Cmd+S from CodeMirror (which loses focus during save)
      if (refocusAfterSaveRef.current) {
        // Small delay to ensure React has finished updating
        setTimeout(() => {
          refocusAfterSaveRef.current?.focus()
          refocusAfterSaveRef.current = null
        }, 0)
      }
    } catch {
      // Error handling is done in the parent component
      // Clear refs on error
      refocusAfterSaveRef.current = null
      clearSaveAndClose()
    }
  }

  // Update handlers - memoized to prevent unnecessary child re-renders
  const handleUrlChange = useCallback((url: string): void => {
    setCurrent((prev) => ({ ...prev, url }))
    setErrors((prev) => (prev.url ? { ...prev, url: undefined } : prev))
  }, [])

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

  const handleArchiveScheduleChange = useCallback((archivedAt: string): void => {
    setCurrent((prev) => ({ ...prev, archivedAt }))
  }, [])

  const handleArchivePresetChange = useCallback((archivePreset: ArchivePreset): void => {
    setCurrent((prev) => ({ ...prev, archivePreset }))
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
      <SaveOverlay isVisible={isSaving} />

      {/* Sticky header with action buttons */}
      <div className="sticky top-0 z-10 shrink-0 bg-white flex items-center justify-between pt-4 pb-4 mb-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {/* Close button */}
          <button
            type="button"
            onClick={requestDiscard}
            disabled={isSaving}
            className={`flex items-center gap-1.5 ${
              isConfirming
                ? 'btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 bg-red-50'
                : 'btn-secondary'
            }`}
          >
            <CloseIcon className="h-4 w-4" />
            {isConfirming ? (
              <span>Discard?</span>
            ) : (
              <span className="hidden md:inline">Close</span>
            )}
          </button>

          {/* Create/Save button - enabled when dirty and valid */}
          {!isReadOnly && (
            <button
              type="submit"
              disabled={isSaving || !canSave}
              className="btn-primary flex items-center gap-1.5"
            >
              <CheckIcon className="h-4 w-4" />
              <span className="hidden md:inline">{isCreate ? 'Create' : 'Save'}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Archive button - active bookmarks only */}
          {viewState === 'active' && onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isSaving}
              className="btn-secondary flex items-center gap-2"
              title="Archive bookmark"
            >
              <ArchiveIcon className="h-4 w-4" />
              <span className="hidden md:inline">Archive</span>
            </button>
          )}

          {/* Unarchive button - archived bookmarks only */}
          {viewState === 'archived' && onUnarchive && (
            <button
              type="button"
              onClick={onUnarchive}
              disabled={isSaving}
              className="btn-secondary flex items-center gap-2"
              title="Restore bookmark"
            >
              <RestoreIcon />
              <span className="hidden md:inline">Restore</span>
            </button>
          )}

          {/* Restore button - deleted bookmarks only */}
          {viewState === 'deleted' && onRestore && (
            <button
              type="button"
              onClick={onRestore}
              disabled={isSaving}
              className="btn-primary flex items-center gap-2"
              title="Restore bookmark"
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
              title={viewState === 'deleted' ? 'Delete permanently' : 'Delete bookmark'}
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
        {/* Header section: banners, URL, title, description, metadata */}
        <div className="space-y-4">
          {/* Read-only banner for deleted bookmarks */}
          {isReadOnly && (
            <div className="alert-warning">
              <p className="text-sm">This bookmark is in trash and cannot be edited. Restore it to make changes.</p>
            </div>
          )}

          {/* General error */}
          {errors.general && (
            <div className="alert-warning">
              <p className="text-sm">{errors.general}</p>
            </div>
          )}

          {/* URL with Fetch Metadata button */}
          <InlineEditableUrl
            ref={urlInputRef}
            value={current.url}
            onChange={handleUrlChange}
            placeholder="https://example.com"
            required={isCreate}
            disabled={isSaving || isReadOnly}
            error={errors.url}
            onFetchMetadata={onFetchMetadata ? handleFetchMetadata : undefined}
            isFetchingMetadata={isFetchingMetadata}
            showFetchSuccess={showFetchSuccess}
          />

          {/* Title */}
          <InlineEditableTitle
            value={current.title}
            onChange={handleTitleChange}
            placeholder="Page title"
            disabled={isSaving || isReadOnly}
            error={errors.title}
          />

          {/* Description */}
          <InlineEditableText
            value={current.description}
            onChange={handleDescriptionChange}
            placeholder="Short summary displayed in lists and used in search results."
            disabled={isSaving || isReadOnly}
            maxLength={config.limits.maxDescriptionLength}
            error={errors.description}
          />

          {/* Metadata row: tags + archive schedule + timestamps */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
            <InlineEditableTags
              ref={tagInputRef}
              value={current.tags}
              onChange={handleTagsChange}
              suggestions={tagSuggestions}
              disabled={isSaving || isReadOnly}
            />

            <span className="text-gray-300">·</span>

            <InlineEditableArchiveSchedule
              value={current.archivedAt}
              onChange={handleArchiveScheduleChange}
              preset={current.archivePreset}
              onPresetChange={handleArchivePresetChange}
              disabled={isSaving || isReadOnly}
            />

            {bookmark && (
              <>
                <span className="text-gray-300">·</span>
                <span>Created {formatDate(bookmark.created_at)}</span>
                {bookmark.updated_at !== bookmark.created_at && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span>Updated {formatDate(bookmark.updated_at)}</span>
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
          placeholder="Content can be either auto-filled from public URLs or manually entered for private pages or custom notes. Content is used in search results."
          maxLength={config.limits.maxContentLength}
          errorMessage={errors.content}
          label=""
          showBorder={true}
          subtleBorder={true}
          onModalStateChange={setIsModalOpen}
        />
      </div>

      {/* Unsaved changes warning dialog */}
      <UnsavedChangesDialog
        isOpen={showDialog}
        onStay={handleStay}
        onLeave={handleLeave}
      />

      {/* Stale check dialogs */}
      {serverUpdatedAt && (
        <StaleDialog
          isOpen={isStale}
          serverUpdatedAt={serverUpdatedAt}
          isDirty={isDirty}
          entityType="bookmark"
          onLoadServerVersion={async () => {
            await onRefresh?.()
            dismissStale()
          }}
          onContinueEditing={dismissStale}
        />
      )}
      <DeletedDialog
        isOpen={isDeleted}
        entityType="bookmark"
        onGoBack={onClose}
      />
    </form>
  )
}
