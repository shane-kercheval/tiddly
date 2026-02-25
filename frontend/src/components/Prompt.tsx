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
import axios from 'axios'
import toast from 'react-hot-toast'
import { InlineEditableTitle } from './InlineEditableTitle'
import { InlineEditableTags, type InlineEditableTagsHandle } from './InlineEditableTags'
import { InlineEditableText } from './InlineEditableText'
import { InlineEditableArchiveSchedule } from './InlineEditableArchiveSchedule'
import { ContentEditor } from './ContentEditor'
import { TableOfContentsSidebar } from './TableOfContentsSidebar'
import { ArgumentsBuilder } from './ArgumentsBuilder'
import { LinkedContentChips, type LinkedContentChipsHandle } from './LinkedContentChips'
import { UnsavedChangesDialog, StaleDialog, DeletedDialog, ConflictDialog, Tooltip, LoadingSpinnerPage } from './ui'
import { SaveOverlay } from './ui/SaveOverlay'
import { PreviewPromptModal } from './PreviewPromptModal'
import { ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon, CheckIcon, HistoryIcon, TagIcon, LinkIcon } from './icons'
import { formatDate, TAG_PATTERN } from '../utils'
import type { ArchivePreset } from '../utils'
import { useLimits } from '../hooks/useLimits'
import { useRightSidebarStore } from '../stores/rightSidebarStore'
import { extractTemplateVariables } from '../utils/extractTemplateVariables'
import { useDiscardConfirmation } from '../hooks/useDiscardConfirmation'
import { useSaveAndClose } from '../hooks/useSaveAndClose'
import { useStaleCheck } from '../hooks/useStaleCheck'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { usePrompts } from '../hooks/usePrompts'
import { useRelationshipState } from '../hooks/useRelationshipState'
import { useQuickCreateLinked } from '../hooks/useQuickCreateLinked'
import { toRelationshipInputs, relationshipsEqual } from '../utils/relationships'
import type { LinkedItem } from '../utils/relationships'
import type { Prompt as PromptType, PromptCreate, PromptUpdate, PromptArgument, RelationshipInputPayload, TagCount } from '../types'

/** Conflict state for 409 responses */
interface ConflictState {
  serverUpdatedAt: string
}

/** Result of building update payload */
interface BuildUpdatesResult {
  updates: PromptUpdate
  tagsToSubmit: string[]
  cleanedArgs: PromptArgument[]
}

/** Default template content for new prompts */
const DEFAULT_PROMPT_CONTENT = `# New Prompt Template

Prompts are reusable templates for LLMs and Agents - instructions, workflows, or any text you want to reuse.

To use your prompts with AI agents like Claude Desktop, Claude Code, or Codex, connect them via instructions found in **Settings > AI Integration**.

## Adding Variables

For dynamic content, add arguments above with the \`+\` button and reference them with double braces like:

{{ variable_name }}

Example: "Please review {{ code_snippet }} for bugs."

## Conditional Content

Use Jinja2 syntax to include optional content by providing an **optional argument** (for example, \`context\`, below):

{%- if context %}
{# This is a Jinja2 comment; it will not be rendered or shown to the agent #}
Context: {{ context }}
{%- endif %}

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
  relationships: RelationshipInputPayload[]
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
  /** Called to refresh the prompt from server (for stale check). Returns the refreshed prompt on success. */
  onRefresh?: () => Promise<PromptType | null>
  /** Called when history button is clicked */
  onShowHistory?: () => void
  /** Called when a linked content item is clicked for navigation */
  onNavigateToLinked?: (item: LinkedItem) => void
  /** Pre-populated relationships from navigation state (quick-create linked) */
  initialRelationships?: RelationshipInputPayload[]
  /** Pre-populated linked item display cache from navigation state */
  initialLinkedItems?: LinkedItem[]
  /** Whether to show the Table of Contents toggle in the toolbar */
  showTocToggle?: boolean
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
  onRefresh,
  onShowHistory,
  onNavigateToLinked,
  initialRelationships,
  initialLinkedItems,
  showTocToggle = false,
}: PromptProps): ReactNode {
  const isCreate = !prompt

  // Fetch tier limits
  const { limits, isLoading: isLoadingLimits, error: limitsError } = useLimits()

  // Stale check hook
  const { fetchPromptMetadata } = usePrompts()
  const fetchUpdatedAt = useCallback(async (id: string): Promise<string> => {
    const metadata = await fetchPromptMetadata(id)
    return metadata.updated_at
  }, [fetchPromptMetadata])
  const { isStale, isDeleted, serverUpdatedAt, dismiss: dismissStale } = useStaleCheck({
    entityId: prompt?.id,
    loadedUpdatedAt: prompt?.updated_at,
    fetchUpdatedAt,
  })

  // Get initial archive state from prompt
  const getInitialArchiveState = (): { archivedAt: string; archivePreset: ArchivePreset } => {
    if (!prompt?.archived_at) {
      return { archivedAt: '', archivePreset: 'none' }
    }
    return { archivedAt: prompt.archived_at, archivePreset: 'custom' }
  }

  // Initialize state from prompt or defaults
  const getInitialState = (): PromptState => {
    const archiveState = getInitialArchiveState()
    return {
      name: prompt?.name ?? '',
      title: prompt?.title ?? '',
      description: prompt?.description ?? '',
      content: prompt?.content ?? (isCreate ? DEFAULT_PROMPT_CONTENT : ''),
      arguments: prompt?.arguments ?? [],
      tags: prompt?.tags ?? initialTags ?? [],
      relationships: prompt?.relationships
        ? toRelationshipInputs(prompt.relationships, 'prompt', prompt.id)
        : (initialRelationships ?? []),
      archivedAt: archiveState.archivedAt,
      archivePreset: archiveState.archivePreset,
    }
  }

  const [original, setOriginal] = useState<PromptState>(getInitialState)
  const [current, setCurrent] = useState<PromptState>(getInitialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  const [conflictState, setConflictState] = useState<ConflictState | null>(null)
  const [contentKey, setContentKey] = useState(0)
  // Skip useEffect sync for a specific updated_at when manually handling refresh (e.g., from StaleDialog)
  const skipSyncForUpdatedAtRef = useRef<string | null>(null)
  // Track current content for detecting external changes (e.g., version restore) in the sync effect.
  // Using a ref avoids stale closure issues and doesn't need to be in the effect's dependency array.
  const currentContentRef = useRef(current.content)
  currentContentRef.current = current.content

  // Relationship state management (display items, add/remove handlers, cache)
  // Must be called before syncStateFromPrompt which depends on clearNewItemsCache
  const { linkedItems, handleAddRelationship, handleRemoveRelationship, clearNewItemsCache } = useRelationshipState({
    contentType: 'prompt',
    entityId: prompt?.id,
    serverRelationships: prompt?.relationships,
    currentRelationships: current.relationships,
    setCurrent,
    initialLinkedItems,
  })

  const syncStateFromPrompt = useCallback((nextPrompt: PromptType, resetEditor = false): void => {
    const archiveState = nextPrompt.archived_at
      ? { archivedAt: nextPrompt.archived_at, archivePreset: 'custom' as ArchivePreset }
      : { archivedAt: '', archivePreset: 'none' as ArchivePreset }
    const newState: PromptState = {
      name: nextPrompt.name ?? '',
      title: nextPrompt.title ?? '',
      description: nextPrompt.description ?? '',
      content: nextPrompt.content ?? '',
      arguments: nextPrompt.arguments ?? [],
      tags: nextPrompt.tags ?? [],
      relationships: nextPrompt.relationships
        ? toRelationshipInputs(nextPrompt.relationships, 'prompt', nextPrompt.id)
        : [],
      archivedAt: archiveState.archivedAt,
      archivePreset: archiveState.archivePreset,
    }
    setOriginal(newState)
    setCurrent(newState)
    setConflictState(null)
    clearNewItemsCache()
    if (resetEditor) {
      setContentKey((prev) => prev + 1)
    }
  }, [clearNewItemsCache])

  // Sync internal state when prompt prop changes (e.g., after refresh from conflict resolution)
  // This is intentional - deriving form state from props when they change is a valid pattern
  useEffect(() => {
    if (!prompt) return
    // Skip if we just manually handled the sync for this specific version (e.g., StaleDialog "Load Latest Version")
    // This prevents a race condition where this effect runs without resetEditor after
    // the manual sync already ran with resetEditor, causing the editor not to refresh
    if (skipSyncForUpdatedAtRef.current === prompt.updated_at) {
      skipSyncForUpdatedAtRef.current = null
      return
    }
    // Reset editor if content changed externally (e.g., version restore from history sidebar).
    // After normal saves, currentContentRef already matches prompt.content so no reset occurs.
    const needsEditorReset = (prompt.content ?? '') !== currentContentRef.current
    syncStateFromPrompt(prompt, needsEditorReset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.id, prompt?.updated_at, syncStateFromPrompt])

  // Refs
  const tagInputRef = useRef<InlineEditableTagsHandle>(null)
  const linkedChipsRef = useRef<LinkedContentChipsHandle>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  // Track element to refocus after Cmd+S save (for CodeMirror which loses focus)
  const refocusAfterSaveRef = useRef<HTMLElement | null>(null)

  // ToC sidebar state
  const scrollToLineRef = useRef<((line: number) => void) | null>(null)
  const showToc = useRightSidebarStore((state) => state.activePanel === 'toc')

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
      !relationshipsEqual(current.relationships, original.relationships) ||
      current.archivedAt !== original.archivedAt,
    [current, original]
  )

  // Compute validity for save button (doesn't show error messages, just checks if saveable)
  const isValid = useMemo(() => {
    const nameValid =
      current.name.trim().length > 0 &&
      current.name.length <= (limits?.max_prompt_name_length ?? Infinity) &&
      PROMPT_NAME_PATTERN.test(current.name)
    const titleValid = current.title.length <= (limits?.max_title_length ?? Infinity)
    const descriptionValid = current.description.length <= (limits?.max_description_length ?? Infinity)
    const contentValid =
      current.content.trim().length > 0 &&
      current.content.length <= (limits?.max_prompt_content_length ?? Infinity)

    return nameValid && titleValid && descriptionValid && contentValid
  }, [current.name, current.title, current.description, current.content, limits])

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

  // Build update payload for existing prompts (shared between handleSubmit and handleConflictSaveMyVersion)
  const buildUpdates = useCallback((): BuildUpdatesResult | null => {
    if (!prompt) return null

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

    // Only send changed fields
    const updates: PromptUpdate = {}
    if (current.name !== prompt.name) updates.name = current.name
    if (current.title !== (prompt.title ?? '')) {
      updates.title = current.title || null
    }
    if (current.description !== (prompt.description ?? '')) {
      updates.description = current.description || null
    }
    if (current.content !== (prompt.content ?? '')) {
      updates.content = current.content || null
    }
    if (JSON.stringify(cleanedArgs) !== JSON.stringify(prompt.arguments ?? [])) {
      updates.arguments = cleanedArgs
    }
    if (JSON.stringify(tagsToSubmit) !== JSON.stringify(prompt.tags ?? [])) {
      updates.tags = tagsToSubmit
    }
    if (!relationshipsEqual(current.relationships, original.relationships)) {
      updates.relationships = current.relationships
    }
    const newArchivedAt = current.archivedAt || null
    const oldArchivedAt = prompt.archived_at || null
    if (newArchivedAt !== oldArchivedAt) {
      updates.archived_at = newArchivedAt
    }

    return { updates, tagsToSubmit, cleanedArgs }
  }, [prompt, current, original.relationships])

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
      // Only warn if dirty AND no modal is open (editor modal OR preview modal)
      if (isDirty && !isModalOpen && !isPreviewModalOpen) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome to show the dialog
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, isModalOpen, isPreviewModalOpen])

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

  // Validation (only called after loading guard, so limits is guaranteed to exist)
  const validate = (): boolean => {
    if (!limits) return false // Type guard, should never happen in practice

    const newErrors: FormErrors = {}

    // Name validation
    if (!current.name.trim()) {
      newErrors.name = 'Name is required'
    } else if (current.name.length > limits.max_prompt_name_length) {
      newErrors.name = `Name must be ${limits.max_prompt_name_length} characters or less`
    } else if (!PROMPT_NAME_PATTERN.test(current.name)) {
      newErrors.name =
        'Name must use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number (e.g., code-review)'
    }

    // Title validation
    if (current.title && current.title.length > limits.max_title_length) {
      newErrors.title = `Title exceeds ${limits.max_title_length.toLocaleString()} characters`
    }

    // Description validation
    if (current.description.length > limits.max_description_length) {
      newErrors.description = `Description exceeds ${limits.max_description_length.toLocaleString()} characters`
    }

    // Content validation
    if (!current.content.trim()) {
      newErrors.content = 'Template content is required'
    } else if (current.content.length > limits.max_prompt_content_length) {
      newErrors.content = `Content exceeds ${limits.max_prompt_content_length.toLocaleString()} characters`
    }

    // Arguments validation
    const argNames = new Set<string>()
    for (let i = 0; i < current.arguments.length; i++) {
      const arg = current.arguments[i]
      if (!arg.name.trim()) {
        newErrors.arguments = `Argument ${i + 1} name is required`
        break
      }
      if (arg.name.length > limits.max_argument_name_length) {
        newErrors.arguments = `Argument "${arg.name}" exceeds ${limits.max_argument_name_length} characters`
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

    let tagsToSubmit: string[]
    let cleanedArgs: PromptArgument[]

    try {
      if (isCreate) {
        // Get any pending tag text for create
        const pendingTag = tagInputRef.current?.getPendingValue() ?? ''
        tagsToSubmit = [...current.tags]
        if (pendingTag) {
          const normalized = pendingTag.toLowerCase().trim()
          if (TAG_PATTERN.test(normalized) && !tagsToSubmit.includes(normalized)) {
            tagsToSubmit.push(normalized)
            tagInputRef.current?.clearPending()
          }
        }

        // Clean up arguments
        cleanedArgs = current.arguments.map((arg) => ({
          ...arg,
          description: arg.description?.trim() || null,
          required: arg.required ?? false,
        }))

        const createData: PromptCreate = {
          name: current.name,
          title: current.title || undefined,
          description: current.description || undefined,
          content: current.content || undefined,
          arguments: cleanedArgs.length > 0 ? cleanedArgs : undefined,
          tags: tagsToSubmit,
          relationships: current.relationships.length > 0 ? current.relationships : undefined,
          archived_at: current.archivedAt || undefined,
        }
        // For creates, onSave navigates away - prevent blocker from showing
        confirmLeave()
        await onSave(createData)
      } else {
        const result = buildUpdates()
        if (!result) return
        const { updates, tagsToSubmit: tags, cleanedArgs: args } = result
        tagsToSubmit = tags
        cleanedArgs = args

        // Nothing changed — still honour close request, but skip the API call
        if (Object.keys(updates).length === 0) {
          checkAndClose()
          return
        }

        // Include expected_updated_at for optimistic locking (prevents overwriting concurrent edits)
        if (prompt?.updated_at) {
          updates.expected_updated_at = prompt.updated_at
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
        relationships: current.relationships,
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
      // Check for 409 Conflict (version mismatch)
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const detail = err.response.data?.detail
        if (detail?.error === 'conflict' && detail?.server_state) {
          setConflictState({
            serverUpdatedAt: detail.server_state.updated_at,
          })
          refocusAfterSaveRef.current = null
          clearSaveAndClose()
          return
        }
      }
      // Handle field-specific errors from parent (e.g., NAME_CONFLICT)
      if (err instanceof SaveError) {
        setErrors((prev) => ({ ...prev, ...err.fieldErrors }))
        refocusAfterSaveRef.current = null
        clearSaveAndClose()
        return  // SaveError is handled - don't propagate
      }
      // Other errors: clear refs and let parent handle
      refocusAfterSaveRef.current = null
      clearSaveAndClose()
      throw err
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

  // Quick-create linked entity navigation
  const handleQuickCreate = useQuickCreateLinked({
    contentType: 'prompt',
    contentId: prompt?.id ?? null,
    contentTitle: prompt?.title ?? (current.title || null),
    contentPromptName: prompt?.name ?? (current.name || null),
  })

  const handleArgumentsChange = useCallback((args: PromptArgument[]): void => {
    setCurrent((prev) => ({ ...prev, arguments: args }))
    setErrors((prev) => (prev.arguments ? { ...prev, arguments: undefined } : prev))
  }, [])

  // Conflict resolution handlers
  const handleConflictLoadServerVersion = useCallback(async (): Promise<void> => {
    const refreshed = await onRefresh?.()
    if (refreshed) {
      // Set flag to skip the prop sync for this specific version since we're handling it here
      // with resetEditor=true. Otherwise the useEffect would run without resetEditor
      // and the editor wouldn't refresh properly.
      skipSyncForUpdatedAtRef.current = refreshed.updated_at
      syncStateFromPrompt(refreshed, true)
    }
  }, [onRefresh, syncStateFromPrompt])

  const handleConflictSaveMyVersion = useCallback(async (): Promise<void> => {
    const result = buildUpdates()
    if (!result) return
    const { updates, tagsToSubmit, cleanedArgs } = result

    // Guard against no-op updates (user may have reverted changes while dialog was open)
    if (Object.keys(updates).length === 0) {
      setConflictState(null)
      return
    }

    // Note: NOT including expected_updated_at - this forces the save to overwrite server version

    try {
      await onSave(updates)
      setOriginal({
        name: current.name,
        title: current.title,
        description: current.description,
        content: current.content,
        arguments: cleanedArgs,
        tags: tagsToSubmit,
        relationships: current.relationships,
        archivedAt: current.archivedAt,
        archivePreset: current.archivePreset,
      })
      setConflictState(null)
    } catch (err) {
      // Handle field-specific errors (e.g., NAME_CONFLICT)
      if (err instanceof SaveError) {
        setErrors((prev) => ({ ...prev, ...err.fieldErrors }))
        setConflictState(null)
        return
      }
      toast.error('Failed to save - please try again')
    }
  }, [buildUpdates, current, onSave])

  const handleConflictDoNothing = useCallback((): void => {
    setConflictState(null)
  }, [])

  // Prevent form submission on Enter in inputs
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
    }
  }

  // Error state: show message if limits fetch failed
  if (limitsError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-4">
          <p className="text-red-600 font-medium">Failed to load configuration</p>
          <p className="text-sm text-gray-500 mt-1">Please refresh the page to try again.</p>
        </div>
      </div>
    )
  }

  // Loading guard: don't render form until limits are available
  if (isLoadingLimits || !limits) {
    return <LoadingSpinnerPage label="Loading prompt..." />
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className={`flex flex-col h-full w-full ${fullWidth ? '' : 'max-w-4xl'}`}
    >
      <SaveOverlay isVisible={isSaving} />

      {/* Sticky header - outer div extends wider to hide scrolling content borders */}
      <div className="sticky top-0 z-10 shrink-0 bg-white -ml-2 pl-2 -mr-2 pr-2">
        <div className="flex items-center justify-between py-1.5 border-b border-gray-200">
          <div className="flex items-center gap-2">
          {/* Close button */}
          <button
            type="button"
            onClick={requestDiscard}
            disabled={isSaving}
            aria-label={isConfirming ? 'Discard changes' : 'Close'}
            className={`flex items-center gap-1.5 ${
              isConfirming
                ? 'btn-ghost text-red-600 hover:text-red-700 bg-red-50'
                : 'btn-ghost'
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
              aria-label={isCreate ? 'Create' : 'Save'}
              className="btn-primary flex items-center gap-1.5"
            >
              <CheckIcon className="h-4 w-4" />
              <span className="hidden md:inline">{isCreate ? 'Create' : 'Save'}</span>
            </button>
          )}

          {/* Preview button - only for saved prompts with arguments, disabled when dirty */}
          {!isCreate && !isReadOnly && prompt && prompt.arguments && prompt.arguments.length > 0 && (
            <Tooltip content={isDirty ? 'Save changes before previewing' : null} compact>
              <button
                type="button"
                onClick={() => setIsPreviewModalOpen(true)}
                disabled={isSaving || isDirty}
                className="btn-ghost"
              >
                Preview
              </button>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* History button - existing prompts only */}
          {!isCreate && onShowHistory && (
            <button
              type="button"
              onClick={onShowHistory}
              disabled={isSaving}
              aria-label="History"
              className="btn-ghost flex items-center gap-2"
            >
              <HistoryIcon className="h-4 w-4" />
              <span className="hidden md:inline">History</span>
            </button>
          )}

          {/* Archive button - active prompts only */}
          {viewState === 'active' && onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isSaving}
              aria-label="Archive"
              className="btn-ghost flex items-center gap-2"
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
              aria-label="Restore"
              className="btn-ghost flex items-center gap-2"
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
              aria-label="Restore"
              className="btn-primary flex items-center gap-2"
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
              aria-label={viewState === 'deleted' ? 'Delete permanently' : 'Delete'}
              className="btn-ghost text-red-600 hover:text-red-700 hover:bg-red-50 flex items-center gap-2"
            >
              <TrashIcon />
              <span className="hidden md:inline">
                {viewState === 'deleted' ? 'Delete Permanently' : 'Delete'}
              </span>
            </button>
          )}
          </div>
        </div>
      </div>

      {/* Scrollable content - padding with negative margin gives room for focus rings to show */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-2 pl-2 -ml-2 -mr-2 pt-5 -mt-1">
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
            className="text-lg text-gray-600 placeholder:!text-[#b5bac2]"
          />

          {/* Description */}
          <InlineEditableText
            value={current.description}
            onChange={handleDescriptionChange}
            placeholder="Add a description. This description helps users/agents understand the purpose of the prompt and how to use it."
            disabled={isSaving || isReadOnly}
            maxLength={limits.max_description_length}
            error={errors.description}
          />

          {/* Metadata: icons row + chips row */}
          <div className="space-y-1.5 pb-1">
            {/* Row 1: action icons + auto-archive + timestamps */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
              {/* Add tag button */}
              <Tooltip content="Add tag" compact delay={500}>
                <button
                  type="button"
                  onClick={() => tagInputRef.current?.startAdding()}
                  disabled={isSaving || isReadOnly}
                  className={`inline-flex items-center h-5 px-1 text-gray-500 rounded transition-colors ${
                    isSaving || isReadOnly ? 'cursor-not-allowed' : 'hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  aria-label="Add tag"
                >
                  <TagIcon className="h-4 w-4" />
                </button>
              </Tooltip>

              {/* Add link button */}
              <Tooltip content="Link content" compact delay={500}>
                <button
                  type="button"
                  onClick={() => linkedChipsRef.current?.startAdding()}
                  disabled={isSaving || isReadOnly}
                  className={`inline-flex items-center h-5 px-1 text-gray-500 rounded transition-colors ${
                    isSaving || isReadOnly ? 'cursor-not-allowed' : 'hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  aria-label="Link content"
                >
                  <LinkIcon className="h-4 w-4" />
                </button>
              </Tooltip>

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

            {/* Row 2: tag pills + linked content chips */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
              <InlineEditableTags
                ref={tagInputRef}
                value={current.tags}
                onChange={handleTagsChange}
                suggestions={tagSuggestions}
                disabled={isSaving || isReadOnly}
                showAddButton={false}
              />

              <LinkedContentChips
                ref={linkedChipsRef}
                contentType="prompt"
                contentId={prompt?.id ?? null}
                items={linkedItems}
                onAdd={handleAddRelationship}
                onRemove={handleRemoveRelationship}
                onNavigate={onNavigateToLinked}
                disabled={isSaving || isReadOnly}
                showAddButton={false}
                onQuickCreate={handleQuickCreate}
              />
            </div>
          </div>
        </div>

        {/* Arguments section */}
        <div className="mt-3">
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
            key={`${prompt?.id ?? 'new'}-${contentKey}`}
            value={current.content}
            onChange={handleContentChange}
            disabled={isSaving || isReadOnly}
            hasError={!!errors.content}
            minHeight="300px"
            placeholder="Write your template in markdown with Jinja2 syntax..."
            maxLength={limits.max_prompt_content_length}
            errorMessage={errors.content}
            label=""
            showBorder={true}
            subtleBorder={true}
            showJinjaTools={true}
            onModalStateChange={setIsModalOpen}
            onSaveAndClose={!isReadOnly ? () => { requestSaveAndClose(); formRef.current?.requestSubmit() } : undefined}
            onDiscard={!isReadOnly ? () => { setCurrent(original); resetConfirmation() } : undefined}
            originalContent={original.content}
            isDirty={isDirty}
            scrollToLineRef={scrollToLineRef}
            showTocToggle={showTocToggle}
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

      {/* Stale check dialogs */}
      {serverUpdatedAt && (
        <StaleDialog
          isOpen={isStale}
          isDirty={isDirty}
          entityType="prompt"
          currentContent={current.content}
          onLoadServerVersion={async () => {
            const refreshed = await onRefresh?.()
            if (refreshed) {
              // Set flag to skip the prop sync for this specific version since we're handling it here
              // with resetEditor=true. Otherwise the useEffect would run without resetEditor
              // and the editor wouldn't refresh properly.
              skipSyncForUpdatedAtRef.current = refreshed.updated_at
              syncStateFromPrompt(refreshed, true)
              dismissStale()
            }
          }}
          onContinueEditing={dismissStale}
        />
      )}
      <DeletedDialog
        isOpen={isDeleted}
        entityType="prompt"
        onGoBack={onClose}
      />

      {/* Conflict dialog (shown when save returns 409) */}
      {conflictState && (
        <ConflictDialog
          isOpen={true}
          currentContent={current.content}
          onLoadServerVersion={handleConflictLoadServerVersion}
          onSaveMyVersion={handleConflictSaveMyVersion}
          onDoNothing={handleConflictDoNothing}
        />
      )}
      {/* Table of Contents sidebar */}
      {showTocToggle && showToc && (
        <TableOfContentsSidebar
          content={current.content}
          onHeadingClick={(line) => scrollToLineRef.current?.(line)}
        />
      )}
    </form>
  )
}
