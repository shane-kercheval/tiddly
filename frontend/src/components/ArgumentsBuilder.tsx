/**
 * Component for building and managing prompt arguments.
 */
import type { ReactNode } from 'react'
import type { PromptArgument } from '../types'
import { PlusIcon, ChevronUpIcon, ChevronDownIcon, CloseIcon, SparklesIcon } from './icons'
import { Tooltip } from './ui'
import { ARG_NAME_PATTERN } from '../constants/validation'
import { useCharacterLimit } from '../hooks/useCharacterLimit'
import { CharacterLimitFeedback } from './CharacterLimitFeedback'

interface ArgumentRowProps {
  arg: PromptArgument
  index: number
  disabled: boolean
  maxNameLength?: number
  maxDescriptionLength?: number
  onUpdate: (index: number, field: keyof PromptArgument, value: string | boolean | null) => void
  onRemove: (index: number) => void
  /** Called when the sparkle icon for the name field is clicked. */
  onSuggestName?: (index: number) => void
  /** Called when the sparkle icon for the description field is clicked. */
  onSuggestDescription?: (index: number) => void
  /** Whether this argument's name is currently being suggested. */
  isSuggestingName?: boolean
  /** Whether this argument's description is currently being suggested. */
  isSuggestingDescription?: boolean
  /** Whether a generate-all request is in flight (disables per-argument suggestions). */
  isSuggestingAll?: boolean
}

function ArgumentRow({
  arg,
  index,
  disabled,
  maxNameLength,
  maxDescriptionLength,
  onUpdate,
  onRemove,
  onSuggestName,
  onSuggestDescription,
  isSuggestingName = false,
  isSuggestingDescription = false,
  isSuggestingAll = false,
}: ArgumentRowProps): ReactNode {
  const nameLimit = useCharacterLimit(arg.name.length, maxNameLength)
  const descLimit = useCharacterLimit(arg.description?.length ?? 0, maxDescriptionLength)

  const namePatternError = arg.name && !ARG_NAME_PATTERN.test(arg.name)
    ? 'Must start with a letter, use only lowercase letters, numbers, and underscores'
    : undefined

  // Name suggest: enabled when description exists
  const nameSuggestDisabled = !(arg.description?.trim())
  // Description suggest: enabled when name exists
  const descSuggestDisabled = !arg.name.trim()

  return (
    <div className="flex-1">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-[1] min-w-[140px]">
          {onSuggestName ? (
            /* When AI icon is present, the wrapper provides the input border/ring so the
               icon sits inside the visual input box — same pattern as InlineEditableTitle. */
            <div className={`group/suggest-name flex items-center rounded-lg border bg-gray-50/50 transition-all focus-within:border-gray-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-gray-900/5 ${namePatternError || nameLimit.exceeded ? 'border-red-200 ring-2 ring-red-200' : 'border-gray-200'} ${disabled ? 'bg-gray-100' : ''}`}>
              <input
                type="text"
                value={arg.name}
                onChange={(e) => {
                  const newValue = e.target.value.toLowerCase()
                  onUpdate(index, 'name', newValue)
                }}
                placeholder="argument_name"
                disabled={disabled}
                className="w-full bg-transparent border-none outline-none px-2.5 py-1.5 font-mono text-sm placeholder:text-gray-400 disabled:text-gray-500"
                aria-label={`Argument ${index + 1} name`}
              />
              <Tooltip
                content={nameSuggestDisabled ? 'Add a description to suggest a name' : 'Suggest name'}
                compact
                delay={500}
              >
                <button
                  type="button"
                  onClick={() => onSuggestName(index)}
                  disabled={nameSuggestDisabled || isSuggestingName || isSuggestingAll || disabled}
                  className="shrink-0 p-0.5 mr-1 rounded text-gray-300 opacity-0 group-hover/suggest-name:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-gray-500 hover:bg-gray-100 disabled:opacity-0 disabled:group-hover/suggest-name:opacity-40 disabled:focus-visible:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
                  aria-label={`Suggest name for argument ${index + 1}`}
                >
                  {isSuggestingName ? (
                    <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  ) : (
                    <SparklesIcon className="h-4 w-4" />
                  )}
                </button>
              </Tooltip>
            </div>
          ) : (
            <input
              type="text"
              value={arg.name}
              onChange={(e) => {
                const newValue = e.target.value.toLowerCase()
                onUpdate(index, 'name', newValue)
              }}
              placeholder="argument_name"
              disabled={disabled}
              className={`input py-1.5 font-mono text-sm w-full ${namePatternError || nameLimit.exceeded ? 'ring-2 ring-red-200' : ''}`}
              aria-label={`Argument ${index + 1} name`}
            />
          )}
          {namePatternError && <p className="mt-0.5 text-xs text-red-500">{namePatternError}</p>}
          <CharacterLimitFeedback limit={nameLimit} />
        </div>
        <div className="flex-[4] min-w-[220px]">
          {onSuggestDescription ? (
            <div className={`group/suggest-desc flex items-center rounded-lg border bg-gray-50/50 transition-all focus-within:border-gray-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-gray-900/5 ${descLimit.exceeded ? 'border-red-200 ring-2 ring-red-200' : 'border-gray-200'} ${disabled ? 'bg-gray-100' : ''}`}>
              <input
                type="text"
                value={arg.description || ''}
                onChange={(e) => {
                  const newValue = e.target.value
                  onUpdate(index, 'description', newValue || null)
                }}
                placeholder="Description (optional). This description helps users/agents understand how to use the argument."
                disabled={disabled}
                className="w-full bg-transparent border-none outline-none px-2.5 py-1.5 text-sm placeholder:text-gray-400 disabled:text-gray-500"
                aria-label={`Argument ${index + 1} description`}
              />
              <Tooltip
                content={descSuggestDisabled ? 'Add a name to suggest a description' : 'Suggest description'}
                compact
                delay={500}
              >
                <button
                  type="button"
                  onClick={() => onSuggestDescription(index)}
                  disabled={descSuggestDisabled || isSuggestingDescription || isSuggestingAll || disabled}
                  className="shrink-0 p-0.5 mr-1 rounded text-gray-300 opacity-0 group-hover/suggest-desc:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-gray-500 hover:bg-gray-100 disabled:opacity-0 disabled:group-hover/suggest-desc:opacity-40 disabled:focus-visible:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
                  aria-label={`Suggest description for argument ${index + 1}`}
                >
                  {isSuggestingDescription ? (
                    <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  ) : (
                    <SparklesIcon className="h-4 w-4" />
                  )}
                </button>
              </Tooltip>
            </div>
          ) : (
            <input
              type="text"
              value={arg.description || ''}
              onChange={(e) => {
                const newValue = e.target.value
                onUpdate(index, 'description', newValue || null)
              }}
              placeholder="Description (optional). This description helps users/agents understand how to use the argument."
              disabled={disabled}
              className={`input py-1.5 text-sm w-full ${descLimit.exceeded ? 'ring-2 ring-red-200' : ''}`}
              aria-label={`Argument ${index + 1} description`}
            />
          )}
          <CharacterLimitFeedback limit={descLimit} />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer mt-1.5">
          <input
            type="checkbox"
            checked={arg.required ?? false}
            onChange={(e) => onUpdate(index, 'required', e.target.checked)}
            disabled={disabled}
            className="rounded border-gray-300"
          />
          Required
        </label>
        <button
          type="button"
          onClick={() => onRemove(index)}
          disabled={disabled}
          className="btn-icon-danger mt-1.5"
          aria-label={`Remove argument ${index + 1}`}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

interface ArgumentsBuilderProps {
  /** Current list of arguments */
  arguments: PromptArgument[]
  /** Called when arguments change */
  onChange: (args: PromptArgument[]) => void
  /** Whether the form is disabled */
  disabled?: boolean
  /** Error message to display */
  error?: string
  /** Maximum length for argument names */
  maxNameLength?: number
  /** Maximum length for argument descriptions */
  maxDescriptionLength?: number
  /** Called when the generate-all sparkle icon is clicked. Omit to hide all AI icons. */
  onSuggestAll?: () => void
  /** Whether a generate-all request is in flight. */
  isSuggestingAll?: boolean
  /** Whether the generate-all icon should be disabled (no prompt content). */
  suggestAllDisabled?: boolean
  /** Tooltip text for the disabled generate-all icon. */
  suggestAllTooltip?: string
  /** Called when the sparkle icon for an argument's name is clicked. */
  onSuggestName?: (index: number) => void
  /** Called when the sparkle icon for an argument's description is clicked. */
  onSuggestDescription?: (index: number) => void
  /** Index of the argument currently being suggested for. */
  suggestingIndex?: number | null
  /** Which field is being suggested for the argument at suggestingIndex. */
  suggestingField?: 'name' | 'description' | null
}

/**
 * ArgumentsBuilder provides UI for managing prompt arguments.
 *
 * Features:
 * - Add new arguments
 * - Edit argument name, description, and required flag
 * - Remove arguments
 * - Reorder arguments with up/down buttons
 * - AI sparkle icons for suggesting arguments (when AI available)
 */
export function ArgumentsBuilder({
  arguments: args,
  onChange,
  disabled = false,
  error,
  maxNameLength,
  maxDescriptionLength,
  onSuggestAll,
  isSuggestingAll = false,
  suggestAllDisabled = false,
  suggestAllTooltip,
  onSuggestName,
  onSuggestDescription,
  suggestingIndex = null,
  suggestingField = null,
}: ArgumentsBuilderProps): ReactNode {
  const addArgument = (): void => {
    onChange([...args, { name: '', description: null, required: false }])
  }

  const updateArgument = (index: number, field: keyof PromptArgument, value: string | boolean | null): void => {
    onChange(
      args.map((arg, i) => (i === index ? { ...arg, [field]: value } : arg))
    )
  }

  const removeArgument = (index: number): void => {
    onChange(args.filter((_, i) => i !== index))
  }

  const moveArgument = (index: number, direction: 'up' | 'down'): void => {
    const newArgs = [...args]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newArgs.length) return
    ;[newArgs[index], newArgs[targetIndex]] = [newArgs[targetIndex], newArgs[index]]
    onChange(newArgs)
  }

  const showAIIcons = !!onSuggestAll

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <label className="label">Arguments</label>
        <div className="flex items-center gap-1">
          {showAIIcons && (
            <Tooltip
              content={suggestAllDisabled && suggestAllTooltip ? suggestAllTooltip : 'Generate arguments from template'}
              compact
              delay={500}
              position="left"
            >
              <button
                type="button"
                onClick={onSuggestAll}
                disabled={suggestAllDisabled || isSuggestingAll || disabled}
                className="btn-icon text-gray-300 hover:text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
                aria-label="Generate arguments from template"
              >
                {isSuggestingAll ? (
                  <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                  <SparklesIcon className="h-4 w-4" />
                )}
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={addArgument}
            disabled={disabled}
            className="btn-icon"
            aria-label="Add argument"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <p className="error-text mb-2">{error}</p>}

      {args.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No arguments defined. Arguments are passed by either the human or AI when using the prompt and can be referenced in the template using jinja syntax.
        </p>
      ) : (
        <div className="space-y-0">
          {args.map((arg, index) => (
            <div key={index}>
              <div className="flex items-start gap-3">
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5 -mt-0.5">
                  <button
                    type="button"
                    onClick={() => moveArgument(index, 'up')}
                    disabled={index === 0 || disabled}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                    aria-label={`Move argument ${index + 1} up`}
                  >
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveArgument(index, 'down')}
                    disabled={index === args.length - 1 || disabled}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                    aria-label={`Move argument ${index + 1} down`}
                  >
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                <ArgumentRow
                  arg={arg}
                  index={index}
                  disabled={disabled}
                  maxNameLength={maxNameLength}
                  maxDescriptionLength={maxDescriptionLength}
                  onUpdate={updateArgument}
                  onRemove={removeArgument}
                  onSuggestName={showAIIcons ? onSuggestName : undefined}
                  onSuggestDescription={showAIIcons ? onSuggestDescription : undefined}
                  isSuggestingName={suggestingIndex === index && suggestingField === 'name'}
                  isSuggestingDescription={suggestingIndex === index && suggestingField === 'description'}
                  isSuggestingAll={isSuggestingAll}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
