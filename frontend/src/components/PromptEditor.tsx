/**
 * Component for editing prompt content with arguments builder.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ReactNode, FormEvent } from 'react'
import { TagInput } from './TagInput'
import type { TagInputHandle } from './TagInput'
import { MarkdownEditor } from './MarkdownEditor'
import { ArgumentsBuilder } from './ArgumentsBuilder'
import { usePromptDraft } from '../hooks/usePromptDraft'
import type { DraftData } from '../hooks/usePromptDraft'
import type { Prompt, PromptCreate, PromptUpdate, PromptArgument, TagCount } from '../types'
import { TAG_PATTERN } from '../utils'
import { extractTemplateVariables } from '../utils/extractTemplateVariables'
import { config } from '../config'
import { ArchiveIcon, TrashIcon, CloseIcon, CheckIcon } from './icons'

/** Default template content for new prompts */
const DEFAULT_PROMPT_CONTENT = `# Getting Started with Prompts

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

/** Key for persisting editor wrap text preference */
const WRAP_TEXT_KEY = 'editor_wrap_text'

/**
 * Load wrap text preference from localStorage.
 * Defaults to true (wrap on) if not set.
 */
function loadWrapTextPreference(): boolean {
  try {
    const stored = localStorage.getItem(WRAP_TEXT_KEY)
    // Default to true if not set
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

/**
 * Save wrap text preference to localStorage.
 */
function saveWrapTextPreference(wrap: boolean): void {
  try {
    localStorage.setItem(WRAP_TEXT_KEY, String(wrap))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Regex for validating prompt names.
 * Must start and end with alphanumeric, hyphens only between segments.
 * Matches backend: ^[a-z0-9]+(-[a-z0-9]+)*$
 */
const PROMPT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Regex for validating argument names (lowercase with underscores) */
const ARG_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

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
  const [wrapText, setWrapText] = useState(loadWrapTextPreference)

  const handleWrapTextChange = (wrap: boolean): void => {
    setWrapText(wrap)
    saveWrapTextPreference(wrap)
  }

  // Memoize original values for draft comparison
  const originalValues = useMemo(() => ({
    name: prompt?.name || '',
    title: prompt?.title || '',
    description: prompt?.description || '',
    content: prompt?.content || '',
    arguments: prompt?.arguments || [],
    tags: prompt?.tags || initialTags || [],
  }), [prompt, initialTags])

  // Draft restore handler
  const handleDraftRestore = useCallback((draft: DraftData): void => {
    setForm({
      name: draft.name,
      title: draft.title,
      description: draft.description,
      content: draft.content,
      arguments: draft.arguments,
      tags: draft.tags,
    })
  }, [])

  // Use the draft hook for autosave functionality
  const { hasDraft, isDirty, restoreDraft, discardDraft, clearDraft } = usePromptDraft({
    promptId: prompt?.id,
    formState: form,
    originalValues,
    onRestore: handleDraftRestore,
  })

  const tagInputRef = useRef<TagInputHandle>(null)
  const formRef = useRef<HTMLFormElement>(null)

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

  // Handler for ArgumentsBuilder changes
  const handleArgumentsChange = useCallback((args: PromptArgument[]): void => {
    setForm((prev) => ({ ...prev, arguments: args }))
    // Clear arguments error when user modifies arguments
    setErrors((prev) => ({ ...prev, arguments: undefined }))
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

    // Validate template variables match arguments using AST-based extraction
    if (form.content && !newErrors.arguments) {
      const { variables: templateVars, error: parseError } = extractTemplateVariables(form.content)

      if (parseError) {
        newErrors.content = `Template syntax error: ${parseError}`
      } else {
        // Check for undefined variables (used in template but not in arguments)
        const undefinedVars = [...templateVars].filter(v => !argNames.has(v))
        if (undefinedVars.length > 0) {
          newErrors.content = `Template uses undefined variable(s): ${undefinedVars.join(', ')}. Add them to arguments or remove from template.`
        }

        // Check for unused arguments (defined but not used in template) - warning only
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

      clearDraft()
    } catch {
      // Error handling is done in the parent component
    }
  }

  // Prevent Enter from submitting - only Cmd+S should submit
  const handleFormKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="flex flex-col h-full">
      {/* Fixed header with action buttons */}
      <div className="shrink-0 bg-white flex items-center justify-between pb-4 mb-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancelRequest}
            disabled={isSubmitting}
            className={`flex items-center gap-1.5 ${confirmingCancel
              ? "btn-secondary text-red-600 hover:text-red-700 hover:border-red-300 bg-red-50"
              : "btn-secondary"
            }`}
          >
            <CloseIcon className="h-4 w-4" />
            {confirmingCancel ? (
              <span>Discard?</span>
            ) : (
              <span className="hidden md:inline">Cancel</span>
            )}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !form.name.trim()}
            className="btn-primary flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <div className="spinner-sm" />
                <span className="hidden md:inline">Saving...</span>
              </>
            ) : (
              <>
                <CheckIcon className="h-4 w-4" />
                <span className="hidden md:inline">{isEditing ? 'Save' : 'Create'}</span>
              </>
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
              <span className="hidden md:inline">Archive</span>
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
              <span className="hidden md:inline">Delete</span>
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
                autoComplete="off"
                data-1p-ignore
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
          <ArgumentsBuilder
            arguments={form.arguments}
            onChange={handleArgumentsChange}
            disabled={isSubmitting}
            error={errors.arguments}
          />
        </section>

        {/* Content field - Jinja2 template with markdown */}
        <MarkdownEditor
          value={form.content}
          onChange={(value) => {
            setForm((prev) => ({ ...prev, content: value }))
            // Clear content error when user modifies content
            if (errors.content) {
              setErrors((prev) => ({ ...prev, content: undefined }))
            }
          }}
          disabled={isSubmitting}
          hasError={!!errors.content}
          minHeight="300px"
          label="Template Content"
          helperText={'Jinja2 template with Markdown. Use {{ variable_name }} for arguments.'}
          maxLength={config.limits.maxPromptContentLength}
          errorMessage={errors.content}
          wrapText={wrapText}
          onWrapTextChange={handleWrapTextChange}
        />
      </div>
    </form>
  )
}
