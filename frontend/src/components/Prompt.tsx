/**
 * Unified Prompt component for viewing and editing prompts.
 *
 * Replaces separate PromptView and PromptEditor components with a single
 * always-editable experience using inline editable components.
 *
 * Features:
 * - Inline editable name (monospace), title, tags, description
 * - ArgumentsBuilder for prompt arguments
 * - ContentEditor with Markdown/Text toggle
 * - Save/Discard buttons appear when dirty
 * - Keyboard shortcuts: Cmd+S to save, Escape to cancel
 * - beforeunload warning when dirty
 * - Read-only mode for deleted items
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { InlineEditableTitle } from './InlineEditableTitle'
import { InlineEditableTags, type InlineEditableTagsHandle } from './InlineEditableTags'
import { InlineEditableText } from './InlineEditableText'
import { InlineEditableArchiveSchedule } from './InlineEditableArchiveSchedule'
import { ContentEditor } from './ContentEditor'
import { ArgumentsBuilder } from './ArgumentsBuilder'
import { UnsavedChangesDialog } from './ui'
import { SaveOverlay } from './ui/SaveOverlay'
import { PreviewPromptModal } from './PreviewPromptModal'
import { ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon, CheckIcon } from './icons'
import { formatDate, TAG_PATTERN } from '../utils'
import type { ArchivePreset } from '../utils'
import { config } from '../config'
import { extractTemplateVariables } from '../utils/extractTemplateVariables'
import { cleanMarkdown } from '../utils/cleanMarkdown'
import { useDiscardConfirmation } from '../hooks/useDiscardConfirmation'
import { useSaveAndClose } from '../hooks/useSaveAndClose'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import type { Prompt as PromptType, PromptCreate, PromptUpdate, PromptArgument, TagCount } from '../types'

/** Default template content for new prompts */
const DEFAULT_PROMPT_CONTENT = `# Replace this content with your prompt

## Getting Started with Prompts

Prompts are reusable templates exposed to **MCP clients** (Claude Desktop, Claude Code, Cursor, etc.).

Create prompts here, then use them directly from your AI tools by configuring MCP access by following instructions in the Settings > MCP Integration.

Templates combine Markdown with **Jinja2** syntax for dynamic content. Define arguments above, then reference them in your template. Simple prompts do not require arguments or jinja.

## Using Variables

Reference arguments with double braces: \`{{ variable_name }}\`

Example: "Please review {{ code_snippet }} for bugs."

## Conditional Content

Use \`{% if %}\` / \`{% endif %}\` to include content only when an argument is provided:

\`\`\`
{%- if context %}
Context: {{ context }}
{%- endif %}
\`\`\`

The \`-\` in \`{%-\` trims whitespace, keeping output clean when conditions are false.

## Tips

- Add arguments using the + button above
- Mark arguments as "Required" if they must always be provided
- Use descriptive argument names like \`code_to_review\` or \`target_language\`

Delete this template and write your own prompt!`

/**
 * Regex for validating prompt names.
 * Must start and end with alphanumeric, hyphens only between segments.
 * Matches backend: ^[a-z0-9]+(-[a-z0-9]+)*$
 */
const PROMPT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Regex for validating argument names (lowercase with underscores) */
const ARG_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

/** Form state for the prompt */
interface PromptState {
  name: string
  title: string
  description: string
  content: string
  arguments: PromptArgument[]
  tags: string[]
  archivedAt: string
  archivePreset: ArchivePreset
}

/** Validation errors */
interface FormErrors {
  name?: string
  title?: string
  description?: string
  content?: string
  arguments?: string
}

/** Error class for save errors with field-specific messages */
export class SaveError extends Error {
  fieldErrors: Partial<FormErrors>

  constructor(message: string, fieldErrors: Partial<FormErrors>) {
    super(message)
    this.name = 'SaveError'
    this.fieldErrors = fieldErrors
  }
}

interface PromptProps {
  /** Existing prompt when editing, undefined when creating */
  prompt?: PromptType
  /** Available tags for autocomplete */
  tagSuggestions: TagCount[]
  /** Called when prompt is saved */
  onSave: (data: PromptCreate | PromptUpdate) => Promise<void>
  /** Called when user closes/cancels */
  onClose: () => void
  /** Whether a save is in progress */
  isSaving?: boolean
  /** Initial tags to populate (e.g., from current list filter) */
  initialTags?: string[]
  /** Called when prompt is archived */
  onArchive?: () => void
  /** Called when prompt is unarchived */
  onUnarchive?: () => void
  /** Called when prompt is deleted */
  onDelete?: () => void
  /** Called when prompt is restored from trash */
  onRestore?: () => void
  /** View state for conditional action buttons */
  viewState?: 'active' | 'archived' | 'deleted'
  /** Whether to use full width layout */
  fullWidth?: boolean
}

/**
 * Prompt provides a unified view/edit experience for prompts.
 */
export function Prompt({
  prompt,
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
}: PromptProps): ReactNode {
  const isCreate = !prompt

  // Get initial archive state from prompt
  const getInitialArchiveState = (): { archivedAt: string; archivePreset: ArchivePreset } => {
    if (!prompt?.archived_at) {
      return { archivedAt: '', archivePreset: 'none' }
    }
    return { archivedAt: prompt.archived_at, archivePreset: 'custom' }
  }

  // Initialize state from prompt or defaults
  // Clean content on initialization to match what Milkdown will output, preventing false dirty state
  const getInitialState = (): PromptState => {
    const archiveState = getInitialArchiveState()
    return {
      name: prompt?.name ?? '',
      title: prompt?.title ?? '',
      description: prompt?.description ?? '',
      content: cleanMarkdown(prompt?.content ?? (isCreate ? DEFAULT_PROMPT_CONTENT : '')),
      arguments: prompt?.arguments ?? [],
      tags: prompt?.tags ?? initialTags ?? [],
      archivedAt: archiveState.archivedAt,
      archivePreset: archiveState.archivePreset,
    }
  }

  const [original, setOriginal] = useState<PromptState>(getInitialState)
  const [current, setCurrent] = useState<PromptState>(getInitialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)

  // Refs
  const tagInputRef = useRef<InlineEditableTagsHandle>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  // Track element to refocus after Cmd+S save (for CodeMirror which loses focus)
  const refocusAfterSaveRef = useRef<HTMLElement | null>(null)

  // Read-only mode for deleted prompts
  const isReadOnly = viewState === 'deleted'

  // Compute dirty state - optimized to avoid deep comparison overhead
  // Check lengths first for quick short-circuit on large content
  const isDirty = useMemo(
    () =>
      current.name !== original.name ||
      current.title !== original.title ||
      current.description !== original.description ||
      current.content.length !== original.content.length ||
      current.content !== original.content ||
      current.tags.length !== original.tags.length ||
      current.tags.some((tag, i) => tag !== original.tags[i]) ||
      current.arguments.length !== original.arguments.length ||
      JSON.stringify(current.arguments) !== JSON.stringify(original.arguments) ||
      current.archivedAt !== original.archivedAt,
    [current, original]
  )

  // Compute validity for save button (doesn't show error messages, just checks if saveable)
  const isValid = useMemo(() => {
    const nameValid =
      current.name.trim().length > 0 &&
      current.name.length <= config.limits.maxPromptNameLength &&
      PROMPT_NAME_PATTERN.test(current.name)
    const titleValid = current.title.length <= config.limits.maxTitleLength
    const descriptionValid = current.description.length <= config.limits.maxDescriptionLength
    const contentValid =
      current.content.trim().length > 0 &&
      current.content.length <= config.limits.maxPromptContentLength

    return nameValid && titleValid && descriptionValid && contentValid
  }, [current.name, current.title, current.description, current.content])

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

  // Auto-focus name for new prompts only
  useEffect(() => {
    if (isCreate && nameInputRef.current) {
      const timer = setTimeout(() => {
        nameInputRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isCreate])

  // Clean up any orphaned drafts from previous versions
  useEffect(() => {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('prompt_draft_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key))
  }, [])

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

  // Validation
  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    // Name validation
    if (!current.name.trim()) {
      newErrors.name = 'Name is required'
    } else if (current.name.length > config.limits.maxPromptNameLength) {
      newErrors.name = `Name must be ${config.limits.maxPromptNameLength} characters or less`
    } else if (!PROMPT_NAME_PATTERN.test(current.name)) {
      newErrors.name =
        'Name must use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number (e.g., code-review)'
    }

    // Title validation
    if (current.title && current.title.length > config.limits.maxTitleLength) {
      newErrors.title = `Title exceeds ${config.limits.maxTitleLength.toLocaleString()} characters`
    }

    // Description validation
    if (current.description.length > config.limits.maxDescriptionLength) {
      newErrors.description = `Description exceeds ${config.limits.maxDescriptionLength.toLocaleString()} characters`
    }

    // Content validation
    if (!current.content.trim()) {
      newErrors.content = 'Template content is required'
    } else if (current.content.length > config.limits.maxPromptContentLength) {
      newErrors.content = `Content exceeds ${config.limits.maxPromptContentLength.toLocaleString()} characters`
    }

    // Arguments validation
    const argNames = new Set<string>()
    for (let i = 0; i < current.arguments.length; i++) {
      const arg = current.arguments[i]
      if (!arg.name.trim()) {
        newErrors.arguments = `Argument ${i + 1} name is required`
        break
      }
      if (arg.name.length > config.limits.maxArgumentNameLength) {
        newErrors.arguments = `Argument "${arg.name}" exceeds ${config.limits.maxArgumentNameLength} characters`
        break
      }
      if (!ARG_NAME_PATTERN.test(arg.name)) {
        newErrors.arguments = `Argument "${arg.name}" must start with a letter and contain only lowercase letters, numbers, and underscores`
        break
      }
      if (argNames.has(arg.name)) {
        newErrors.arguments = `Duplicate argument name: ${arg.name}`
        break
      }
      argNames.add(arg.name)
    }

    // Template variable validation
    if (current.content && !newErrors.arguments) {
      const { variables: templateVars, error: parseError } = extractTemplateVariables(current.content)

      if (parseError) {
        newErrors.content = `Template syntax error: ${parseError}`
      } else {
        // Check for undefined variables (used in template but not in arguments)
        const undefinedVars = [...templateVars].filter((v) => !argNames.has(v))
        if (undefinedVars.length > 0) {
          newErrors.content = `Template uses undefined variable(s): ${undefinedVars.join(', ')}. Add them to arguments or remove from template.`
        }

        // Check for unused arguments (defined but not used in template) - warning only
        const unusedArgs = [...argNames].filter((a) => !templateVars.has(a))
        if (unusedArgs.length > 0) {
          newErrors.arguments = `Unused argument(s): ${unusedArgs.join(', ')}. Remove them or use in template.`
        }
      }
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

    // Clean up arguments (remove empty descriptions)
    const cleanedArgs = current.arguments.map((arg) => ({
      ...arg,
      description: arg.description?.trim() || null,
      required: arg.required ?? false,
    }))

    try {
      if (isCreate) {
        const createData: PromptCreate = {
          name: current.name,
          title: current.title || undefined,
          description: current.description || undefined,
          content: current.content || undefined,
          arguments: cleanedArgs.length > 0 ? cleanedArgs : undefined,
          tags: tagsToSubmit,
          archived_at: current.archivedAt || undefined,
        }
        // For creates, onSave navigates away - prevent blocker from showing
        confirmLeave()
        await onSave(createData)
      } else {
        // For updates, only send changed fields
        const updates: PromptUpdate = {}
        if (current.name !== prompt?.name) updates.name = current.name
        if (current.title !== (prompt?.title ?? '')) {
          updates.title = current.title || null
        }
        if (current.description !== (prompt?.description ?? '')) {
          updates.description = current.description || null
        }
        if (current.content !== (prompt?.content ?? '')) {
          updates.content = current.content || null
        }
        if (JSON.stringify(cleanedArgs) !== JSON.stringify(prompt?.arguments ?? [])) {
          updates.arguments = cleanedArgs
        }
        if (JSON.stringify(tagsToSubmit) !== JSON.stringify(prompt?.tags ?? [])) {
          updates.tags = tagsToSubmit
        }
        // Include archived_at if changed
        const newArchivedAt = current.archivedAt || null
        const oldArchivedAt = prompt?.archived_at || null
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
      setOriginal({
        name: current.name,
        title: current.title,
        description: current.description,
        content: current.content,
        arguments: cleanedArgs,
        tags: tagsToSubmit,
        archivedAt: current.archivedAt,
        archivePreset: current.archivePreset,
      })

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
    } catch (err) {
      // Handle field-specific errors from parent
      if (err instanceof SaveError) {
        setErrors((prev) => ({ ...prev, ...err.fieldErrors }))
      }
      // Clear refs on error
      refocusAfterSaveRef.current = null
      clearSaveAndClose()
    }
  }

  // Update handlers - memoized to prevent unnecessary child re-renders
  const handleNameChange = useCallback((name: string): void => {
    // Auto-lowercase the name
    setCurrent((prev) => ({ ...prev, name: name.toLowerCase() }))
    setErrors((prev) => (prev.name ? { ...prev, name: undefined } : prev))
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

  const handleArgumentsChange = useCallback((args: PromptArgument[]): void => {
    setCurrent((prev) => ({ ...prev, arguments: args }))
    setErrors((prev) => (prev.arguments ? { ...prev, arguments: undefined } : prev))
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

      {/* Fixed header with action buttons */}
      <div className="shrink-0 bg-white flex items-center justify-between pb-4 mb-4 border-b border-gray-200">
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

          {/* Preview button - only for saved prompts with arguments, disabled when dirty */}
          {!isCreate && !isReadOnly && prompt && prompt.arguments && prompt.arguments.length > 0 && (
            <button
              type="button"
              onClick={() => setIsPreviewModalOpen(true)}
              disabled={isSaving || isDirty}
              className="btn-secondary"
              title={isDirty ? 'Save changes before previewing prompt' : 'Preview this prompt with arguments'}
            >
              Preview
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Archive button - active prompts only */}
          {viewState === 'active' && onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isSaving}
              className="btn-secondary flex items-center gap-2"
              title="Archive prompt"
            >
              <ArchiveIcon className="h-4 w-4" />
              <span className="hidden md:inline">Archive</span>
            </button>
          )}

          {/* Unarchive button - archived prompts only */}
          {viewState === 'archived' && onUnarchive && (
            <button
              type="button"
              onClick={onUnarchive}
              disabled={isSaving}
              className="btn-secondary flex items-center gap-2"
              title="Restore prompt"
            >
              <RestoreIcon />
              <span className="hidden md:inline">Restore</span>
            </button>
          )}

          {/* Restore button - deleted prompts only */}
          {viewState === 'deleted' && onRestore && (
            <button
              type="button"
              onClick={onRestore}
              disabled={isSaving}
              className="btn-primary flex items-center gap-2"
              title="Restore prompt"
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
              title={viewState === 'deleted' ? 'Delete permanently' : 'Delete prompt'}
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
        {/* Header section: banners, name, title, description, metadata */}
        <div className="space-y-4">
          {/* Read-only banner for deleted prompts */}
          {isReadOnly && (
            <div className="alert-warning">
              <p className="text-sm">
                This prompt is in trash and cannot be edited. Restore it to make changes.
              </p>
            </div>
          )}

          {/* Name (primary identifier, monospace) */}
          <InlineEditableTitle
            ref={nameInputRef}
            value={current.name}
            onChange={handleNameChange}
            placeholder="prompt-name"
            variant="name"
            required
            disabled={isSaving || isReadOnly}
            error={errors.name}
          />

          {/* Title (optional display name) */}
          <InlineEditableTitle
            value={current.title}
            onChange={handleTitleChange}
            placeholder="Display title (optional)"
            disabled={isSaving || isReadOnly}
            error={errors.title}
            className="text-lg text-gray-600"
          />

          {/* Description */}
          <InlineEditableText
            value={current.description}
            onChange={handleDescriptionChange}
            placeholder="Add a description. This description helps users/agents understand the purpose of the prompt and how to use it."
            disabled={isSaving || isReadOnly}
            maxLength={config.limits.maxDescriptionLength}
            error={errors.description}
          />

          {/* Metadata row: tags + auto-archive + timestamps */}
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

            {prompt && (
              <>
                <span className="text-gray-300">·</span>
                <span>Created {formatDate(prompt.created_at)}</span>
                {prompt.updated_at !== prompt.created_at && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span>Updated {formatDate(prompt.updated_at)}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Arguments section */}
        <div className="mt-6">
          <ArgumentsBuilder
            arguments={current.arguments}
            onChange={handleArgumentsChange}
            disabled={isSaving || isReadOnly}
            error={errors.arguments}
          />
        </div>

        {/* Content editor */}
        <div className="mt-3">
          <ContentEditor
            value={current.content}
            onChange={handleContentChange}
            disabled={isSaving || isReadOnly}
            hasError={!!errors.content}
            minHeight="300px"
            placeholder="Write your template in markdown with Jinja2 syntax..."
            maxLength={config.limits.maxPromptContentLength}
            errorMessage={errors.content}
            label=""
            showBorder={true}
            subtleBorder={true}
            showJinjaTools={true}
          />
        </div>
      </div>

      {/* Unsaved changes warning dialog */}
      <UnsavedChangesDialog
        isOpen={showDialog}
        onStay={handleStay}
        onLeave={handleLeave}
      />

      {/* Preview prompt modal - only rendered when prompt exists */}
      {prompt && (
        <PreviewPromptModal
          isOpen={isPreviewModalOpen}
          onClose={() => setIsPreviewModalOpen(false)}
          prompt={prompt}
        />
      )}
    </form>
  )
}
