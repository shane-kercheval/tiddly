/**
 * Component for editing prompt content with arguments builder.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { TagInput } from './TagInput'
import type { TagInputHandle } from './TagInput'
import { MarkdownEditor } from './MarkdownEditor'
import type { Prompt, PromptCreate, PromptUpdate, PromptArgument, TagCount } from '../types'
import { TAG_PATTERN } from '../utils'
import { config } from '../config'
import { ArchiveIcon, TrashIcon, PlusIcon, ChevronUpIcon, ChevronDownIcon, CloseIcon } from './icons'

/** Default template content for new prompts */
const DEFAULT_PROMPT_CONTENT = `{%- if context %}
## Context
{{ context }}
{%- endif %}

## Task
{{ task }}`

/** Key prefix for localStorage draft storage */
const DRAFT_KEY_PREFIX = 'prompt_draft_'

/**
 * Regex for validating prompt names.
 * Must start and end with alphanumeric, hyphens only between segments.
 * Matches backend: ^[a-z0-9]+(-[a-z0-9]+)*$
 */
const PROMPT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Regex for validating argument names (lowercase with underscores) */
const ARG_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

interface DraftData {
  name: string
  title: string
  description: string
  content: string
  arguments: PromptArgument[]
  tags: string[]
  savedAt: number
}

interface PromptEditorProps {
  /** Existing prompt when editing, undefined when creating */
  prompt?: Prompt
  /** Available tags for autocomplete */
  tagSuggestions: TagCount[]
  /** Called when form is submitted */
  onSubmit: (data: PromptCreate | PromptUpdate) => Promise<void>
  /** Called when user cancels */
  onCancel: () => void
  /** Whether the form is being submitted */
  isSubmitting?: boolean
  /** Initial tags to populate (e.g., from current list filter) */
  initialTags?: string[]
  /** Called when prompt is archived (shown in header when provided) */
  onArchive?: () => void
  /** Called when prompt is deleted (shown in header when provided) */
  onDelete?: () => void
}

interface FormState {
  name: string
  title: string
  description: string
  content: string
  arguments: PromptArgument[]
  tags: string[]
}

interface FormErrors {
  name?: string
  title?: string
  description?: string
  content?: string
  arguments?: string
  tags?: string
  general?: string
}

/**
 * Get the localStorage key for a prompt draft.
 */
function getDraftKey(promptId?: number): string {
  return promptId ? `${DRAFT_KEY_PREFIX}${promptId}` : `${DRAFT_KEY_PREFIX}new`
}

/**
 * Load draft from localStorage if available.
 */
function loadDraft(promptId?: number): DraftData | null {
  try {
    const key = getDraftKey(promptId)
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
function saveDraft(promptId: number | undefined, data: DraftData): void {
  try {
    const key = getDraftKey(promptId)
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

/**
 * Clear draft from localStorage.
 */
function clearDraft(promptId?: number): void {
  try {
    const key = getDraftKey(promptId)
    localStorage.removeItem(key)
  } catch {
    // Ignore errors
  }
}

/**
 * PromptEditor provides a form for creating or editing prompts.
 *
 * Features:
 * - Name input (required, lowercase with hyphens)
 * - Title and description inputs
 * - Arguments builder (add/edit/delete/reorder)
 * - Content textarea for Jinja2 template
 * - Tag input with autocomplete
 * - Draft autosave to localStorage (every 30 seconds)
 * - Keyboard shortcuts: Cmd+S to save, Esc to cancel
 */
export function PromptEditor({
  prompt,
  tagSuggestions,
  onSubmit,
  onCancel,
  isSubmitting = false,
  initialTags,
  onArchive,
  onDelete,
}: PromptEditorProps): ReactNode {
  const isEditing = !!prompt

  const [form, setForm] = useState<FormState>({
    name: prompt?.name || '',
    title: prompt?.title || '',
    description: prompt?.description || '',
    content: prompt?.content ?? (isEditing ? '' : DEFAULT_PROMPT_CONTENT),
    arguments: prompt?.arguments || [],
    tags: prompt?.tags || initialTags || [],
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const cancelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check for existing draft on mount
  const [hasDraft, setHasDraft] = useState(() => {
    const draft = loadDraft(prompt?.id)
    if (!draft) return false

    // Only show prompt if draft is different from current prompt
    const isDifferent = isEditing
      ? draft.name !== prompt?.name ||
        draft.title !== (prompt?.title || '') ||
        draft.description !== (prompt?.description || '') ||
        draft.content !== (prompt?.content || '') ||
        JSON.stringify(draft.arguments) !== JSON.stringify(prompt?.arguments || []) ||
        JSON.stringify(draft.tags) !== JSON.stringify(prompt?.tags || [])
      : draft.name || draft.title || draft.description || draft.content || draft.arguments.length > 0 || draft.tags.length > 0

    return Boolean(isDifferent)
  })

  // Track if form has unsaved changes (for draft saving)
  const isDirty =
    form.name !== (prompt?.name || '') ||
    form.title !== (prompt?.title || '') ||
    form.description !== (prompt?.description || '') ||
    form.content !== (prompt?.content || '') ||
    JSON.stringify(form.arguments) !== JSON.stringify(prompt?.arguments || []) ||
    JSON.stringify(form.tags) !== JSON.stringify(prompt?.tags || initialTags || [])

  const tagInputRef = useRef<TagInputHandle>(null)
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Auto-save draft every 30 seconds, but only when form has changes
  useEffect(() => {
    if (!isDirty) {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
        draftTimerRef.current = null
      }
      return
    }

    draftTimerRef.current = setInterval(() => {
      const draftData: DraftData = {
        name: form.name,
        title: form.title,
        description: form.description,
        content: form.content,
        arguments: form.arguments,
        tags: form.tags,
        savedAt: Date.now(),
      }
      saveDraft(prompt?.id, draftData)
    }, 30000)

    return () => {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
      }
    }
  }, [form, prompt?.id, isDirty])

  // Handle cancel with confirmation if dirty
  const handleCancelRequest = useCallback((): void => {
    if (cancelTimeoutRef.current) {
      clearTimeout(cancelTimeoutRef.current)
      cancelTimeoutRef.current = null
    }

    if (!isDirty) {
      onCancel()
      return
    }

    if (confirmingCancel) {
      onCancel()
    } else {
      setConfirmingCancel(true)
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
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        formRef.current?.requestSubmit()
      }
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
      if (e.key === 'Escape') {
        handleCancelRequest()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleCancelRequest, confirmingCancel, resetCancelConfirmation, onCancel])

  const restoreDraft = useCallback((): void => {
    const draft = loadDraft(prompt?.id)
    if (draft) {
      setForm({
        name: draft.name,
        title: draft.title,
        description: draft.description,
        content: draft.content,
        arguments: draft.arguments,
        tags: draft.tags,
      })
    }
    setHasDraft(false)
  }, [prompt?.id])

  const discardDraft = useCallback((): void => {
    clearDraft(prompt?.id)
    setHasDraft(false)
  }, [prompt?.id])

  // Argument management
  const addArgument = useCallback((): void => {
    setForm((prev) => ({
      ...prev,
      arguments: [
        ...prev.arguments,
        { name: '', description: null, required: false },
      ],
    }))
  }, [])

  const updateArgument = useCallback((index: number, field: keyof PromptArgument, value: string | boolean | null): void => {
    setForm((prev) => ({
      ...prev,
      arguments: prev.arguments.map((arg, i) =>
        i === index ? { ...arg, [field]: value } : arg
      ),
    }))
  }, [])

  const removeArgument = useCallback((index: number): void => {
    setForm((prev) => ({
      ...prev,
      arguments: prev.arguments.filter((_, i) => i !== index),
    }))
  }, [])

  const moveArgument = useCallback((index: number, direction: 'up' | 'down'): void => {
    setForm((prev) => {
      const newArgs = [...prev.arguments]
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= newArgs.length) return prev
      ;[newArgs[index], newArgs[targetIndex]] = [newArgs[targetIndex], newArgs[index]]
      return { ...prev, arguments: newArgs }
    })
  }, [])

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    // Name is required
    if (!form.name.trim()) {
      newErrors.name = 'Name is required'
    } else if (form.name.length > config.limits.maxPromptNameLength) {
      newErrors.name = `Name must be ${config.limits.maxPromptNameLength} characters or less`
    } else if (!PROMPT_NAME_PATTERN.test(form.name)) {
      newErrors.name = 'Name must use lowercase letters, numbers, and hyphens only. Must start and end with a letter or number (e.g., code-review)'
    }

    if (form.title && form.title.length > config.limits.maxTitleLength) {
      newErrors.title = `Title exceeds ${config.limits.maxTitleLength.toLocaleString()} characters`
    }

    if (form.description.length > config.limits.maxDescriptionLength) {
      newErrors.description = `Description exceeds ${config.limits.maxDescriptionLength.toLocaleString()} characters`
    }

    // Content is required
    if (!form.content.trim()) {
      newErrors.content = 'Template content is required'
    } else if (form.content.length > config.limits.maxPromptContentLength) {
      newErrors.content = `Content exceeds ${config.limits.maxPromptContentLength.toLocaleString()} characters`
    }

    // Validate arguments
    const argNames = new Set<string>()
    for (let i = 0; i < form.arguments.length; i++) {
      const arg = form.arguments[i]
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

    // Validate template variables match arguments
    if (form.content && !newErrors.arguments) {
      // Extract Jinja2 variables: {{ var }}, {{ var|filter }}, {%- if var %}, etc.
      // Note: In the character class, } must be first or escaped to be treated as literal
      const variablePattern = /\{\{[\s-]*([a-z_][a-z0-9_]*)[\s|%/}-]/gi
      const controlPattern = /\{%[-\s]*(?:if|elif|for|set|with)[\s]+([a-z_][a-z0-9_]*)/gi
      const templateVars = new Set<string>()

      let match
      while ((match = variablePattern.exec(form.content)) !== null) {
        templateVars.add(match[1].toLowerCase())
      }
      while ((match = controlPattern.exec(form.content)) !== null) {
        templateVars.add(match[1].toLowerCase())
      }

      // Check for undefined variables (used in template but not in arguments)
      const undefinedVars = [...templateVars].filter(v => !argNames.has(v))
      if (undefinedVars.length > 0) {
        newErrors.content = `Template uses undefined variable(s): ${undefinedVars.join(', ')}. Add them to arguments or remove from template.`
      }

      // Check for unused arguments (defined but not used in template)
      if (!newErrors.content) {
        const unusedArgs = [...argNames].filter(a => !templateVars.has(a))
        if (unusedArgs.length > 0) {
          newErrors.arguments = `Unused argument(s): ${unusedArgs.join(', ')}. Remove them or use in template.`
        }
      }
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
      if (TAG_PATTERN.test(normalized) && !tagsToSubmit.includes(normalized)) {
        tagsToSubmit.push(normalized)
        tagInputRef.current?.clearPending()
      }
    }

    // Clean up arguments (remove empty descriptions)
    const cleanedArgs = form.arguments.map(arg => ({
      ...arg,
      description: arg.description?.trim() || null,
      required: arg.required ?? false,
    }))

    try {
      if (isEditing) {
        const updates: PromptUpdate = {}
        if (form.name !== prompt?.name) updates.name = form.name
        if (form.title !== (prompt?.title || ''))
          updates.title = form.title || null
        if (form.description !== (prompt?.description || ''))
          updates.description = form.description || null
        if (form.content !== (prompt?.content || ''))
          updates.content = form.content || null
        if (JSON.stringify(cleanedArgs) !== JSON.stringify(prompt?.arguments || []))
          updates.arguments = cleanedArgs
        if (JSON.stringify(tagsToSubmit) !== JSON.stringify(prompt?.tags || []))
          updates.tags = tagsToSubmit

        await onSubmit(updates)
      } else {
        const createData: PromptCreate = {
          name: form.name,
          title: form.title || undefined,
          description: form.description || undefined,
          content: form.content || undefined,
          arguments: cleanedArgs.length > 0 ? cleanedArgs : undefined,
          tags: tagsToSubmit,
        }
        await onSubmit(createData)
      }

      clearDraft(prompt?.id)
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
            disabled={isSubmitting || !form.name.trim()}
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
              'Create Prompt'
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {onArchive && (
            <button
              type="button"
              onClick={onArchive}
              disabled={isSubmitting}
              className="btn-secondary flex items-center gap-2"
              title="Archive prompt"
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
              title="Delete prompt"
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

        <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 md:p-5 space-y-5">
          {/* Name, Title, Tags row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-6 lg:col-span-3">
              <label htmlFor="name" className="label">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={form.name}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, name: e.target.value.toLowerCase() }))
                  if (errors.name) {
                    setErrors((prev) => ({ ...prev, name: undefined }))
                  }
                }}
                placeholder="code-review"
                disabled={isSubmitting}
                maxLength={config.limits.maxPromptNameLength}
                className={`input mt-1 font-mono ${errors.name ? 'input-error' : ''}`}
                autoFocus
              />
              <p className="helper-text">
                Lowercase letters, numbers, hyphens (e.g., code-review)
              </p>
              {errors.name && <p className="error-text">{errors.name}</p>}
            </div>

            <div className="md:col-span-6 lg:col-span-3">
              <label htmlFor="title" className="label">
                Title
              </label>
              <input
                type="text"
                id="title"
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Code Review Template"
                disabled={isSubmitting}
                maxLength={config.limits.maxTitleLength}
                className={`input mt-1 ${errors.title ? 'input-error' : ''}`}
              />
              <p className="helper-text">
                Optional human-readable name for display purposes.
              </p>
              {errors.title && <p className="error-text">{errors.title}</p>}
            </div>

            <div className="md:col-span-12 lg:col-span-6">
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

          {/* Description row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-12">
              <label htmlFor="description" className="label">
                Description
              </label>
              <textarea
                id="description"
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Brief description of when to use this prompt..."
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
          </div>

          {/* Arguments builder */}
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="label">Arguments</label>
              <button
                type="button"
                onClick={addArgument}
                disabled={isSubmitting}
                className="btn-icon"
                title="Add argument"
                aria-label="Add argument"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>

            {errors.arguments && (
              <p className="error-text mb-2">{errors.arguments}</p>
            )}

            {form.arguments.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No arguments defined. Arguments are passed by either the human or AI when using the prompt and can be referenced in the template using jinja syntax.
              </p>
            ) : (
              <div className="divide-y divide-gray-200">
                {form.arguments.map((arg, index) => (
                  <div
                    key={index}
                    className="py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start gap-3">
                      {/* Reorder buttons */}
                      <div className="flex flex-col gap-0.5 pt-1">
                        <button
                          type="button"
                          onClick={() => moveArgument(index, 'up')}
                          disabled={index === 0 || isSubmitting}
                          className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          title="Move up"
                        >
                          <ChevronUpIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveArgument(index, 'down')}
                          disabled={index === form.arguments.length - 1 || isSubmitting}
                          className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          title="Move down"
                        >
                          <ChevronDownIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Argument fields */}
                      <div className="flex-1 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={arg.name}
                          onChange={(e) => updateArgument(index, 'name', e.target.value.toLowerCase())}
                          placeholder="argument_name"
                          disabled={isSubmitting}
                          className="input py-1.5 font-mono text-sm min-w-[140px] flex-[1]"
                        />
                        <input
                          type="text"
                          value={arg.description || ''}
                          onChange={(e) => updateArgument(index, 'description', e.target.value || null)}
                          placeholder="Description (optional)"
                          disabled={isSubmitting}
                          className="input py-1.5 text-sm min-w-[220px] flex-[4]"
                        />
                        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={arg.required ?? false}
                            onChange={(e) => updateArgument(index, 'required', e.target.checked)}
                            disabled={isSubmitting}
                            className="rounded border-gray-300"
                          />
                          Required
                        </label>
                        <button
                          type="button"
                          onClick={() => removeArgument(index)}
                          disabled={isSubmitting}
                          className="btn-icon-danger"
                          title="Remove argument"
                        >
                          <CloseIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="helper-text mt-2">
              Use lowercase with underscores for argument names (e.g., code_to_review, file_path)
            </p>
          </div>
        </section>

        {/* Content field - Jinja2 template with markdown */}
        <MarkdownEditor
          value={form.content}
          onChange={(value) => setForm((prev) => ({ ...prev, content: value }))}
          disabled={isSubmitting}
          hasError={!!errors.content}
          minHeight="300px"
          label="Template Content"
          helperText={'Jinja2 template with Markdown. Use {{ variable_name }} for arguments.'}
          maxLength={config.limits.maxPromptContentLength}
          errorMessage={errors.content}
        />
      </div>
    </form>
  )
}
