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

interface MaybeTooltipProps {
  content: string
  children: ReactNode
  compact?: boolean
  delay?: number
  position?: 'bottom' | 'left' | 'right'
}

/**
 * Renders children wrapped in <Tooltip> only when `content` is a non-empty
 * string. Empty-string content means "no custom tooltip should appear" —
 * honors the priority rule where in-flight / globally-disabled states
 * suppress the tooltip entirely instead of falling back to a generic label.
 */
function MaybeTooltip(
  { content, children, compact, delay, position }: MaybeTooltipProps,
): ReactNode {
  if (!content) return children
  return (
    <Tooltip content={content} compact={compact} delay={delay} position={position}>
      {children}
    </Tooltip>
  )
}

interface GenerateAllTooltipInput {
  disabled: boolean
  isSuggestingAll: boolean
  suggestingAnyRow: boolean
  suggestAllDisabled: boolean
  suggestAllTooltip?: string
}

/**
 * Priority-aware tooltip string for the generate-all sparkle.
 *
 * Priority (first match wins):
 *   1. Globally disabled (parent `disabled` prop) — no custom tooltip.
 *   2. In flight (`isSuggestingAll` or `suggestingAnyRow`) — no custom
 *      tooltip; the spinner on the active op communicates state.
 *   3. `suggestAllDisabled` with a caller-provided reason — show that
 *      reason (e.g. "No {{ placeholders }} found in template").
 *   4. Otherwise enabled — show the default "Generate arguments" string.
 */
function computeGenerateAllTooltip(
  { disabled, isSuggestingAll, suggestingAnyRow, suggestAllDisabled, suggestAllTooltip }:
    GenerateAllTooltipInput,
): string {
  if (disabled) return ''
  if (isSuggestingAll || suggestingAnyRow) return ''
  if (suggestAllDisabled && suggestAllTooltip) return suggestAllTooltip
  return 'Generate arguments from template'
}

interface ArgumentRowProps {
  arg: PromptArgument
  index: number
  disabled: boolean
  maxNameLength?: number
  maxDescriptionLength?: number
  onUpdate: (index: number, field: keyof PromptArgument, value: string | boolean | null) => void
  onRemove: (index: number) => void
  /** Called when the per-row sparkle is clicked. Omit to hide the sparkle. */
  onSuggestRow?: (index: number) => void
  /** Whether this specific row's suggestion request is in flight. */
  isSuggestingThisRow?: boolean
  /** True iff any per-row sparkle is in flight on this prompt. Cross-mode gate. */
  suggestingAnyRow?: boolean
  /** True iff a generate-all request is in flight. Existing gate. */
  isSuggestingAll?: boolean
  /** True iff this row's sparkle should be disabled (row complete OR no grounding). */
  rowDisabled?: boolean
  /** State-aware tooltip for this row's sparkle. Empty string → default. */
  rowTooltip?: string
}

function ArgumentRow({
  arg,
  index,
  disabled,
  maxNameLength,
  maxDescriptionLength,
  onUpdate,
  onRemove,
  onSuggestRow,
  isSuggestingThisRow = false,
  suggestingAnyRow = false,
  isSuggestingAll = false,
  rowDisabled = false,
  rowTooltip = '',
}: ArgumentRowProps): ReactNode {
  const nameLimit = useCharacterLimit(arg.name.length, maxNameLength)
  const descLimit = useCharacterLimit(arg.description?.length ?? 0, maxDescriptionLength)

  const namePatternError = arg.name && !ARG_NAME_PATTERN.test(arg.name)
    ? 'Must start with a letter, use only lowercase letters, numbers, and underscores'
    : undefined

  // Priority ordering for the sparkle button (first match wins):
  //   1. Globally disabled (parent disabled prop) — no custom tooltip
  //   2. In flight (this row, any row, or generate-all) — no custom tooltip
  //   3. Row complete — "clear a field" tooltip
  //   4. No grounding — "add grounding" tooltip
  // The component layer owns (1) and (2); the integration layer owns (3),
  // (4), and the enabled state tooltip via `rowTooltip`. When a higher-priority
  // reason applies, the tooltip shows no custom text — in-flight state is
  // communicated by the spinner, globally-disabled by the button's enabled
  // state. We skip rendering the <Tooltip> wrapper entirely in those cases
  // rather than falling back to a generic string.
  const anySuggestionInFlight = isSuggestingThisRow || suggestingAnyRow || isSuggestingAll
  const effectiveTooltip = (disabled || anySuggestionInFlight) ? '' : rowTooltip
  const sparkleDisabled = disabled || anySuggestionInFlight || rowDisabled

  return (
    <div className="flex-1">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-[1] min-w-[140px]">
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
          {namePatternError && <p className="mt-0.5 text-xs text-red-500">{namePatternError}</p>}
          <CharacterLimitFeedback limit={nameLimit} />
        </div>
        <div className="flex-[4] min-w-[220px]">
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
        {onSuggestRow && (
          <MaybeTooltip content={effectiveTooltip} compact delay={500} position="left">
            <button
              type="button"
              onClick={() => onSuggestRow(index)}
              disabled={sparkleDisabled}
              className="btn-icon text-gray-300 hover:text-gray-500 mt-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
              aria-label={`Suggest fields for argument ${index + 1}`}
            >
              {isSuggestingThisRow ? (
                <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              ) : (
                <SparklesIcon className="h-4 w-4" />
              )}
            </button>
          </MaybeTooltip>
        )}
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
  /** Whether the generate-all icon should be disabled. */
  suggestAllDisabled?: boolean
  /** Tooltip text for the disabled generate-all icon. */
  suggestAllTooltip?: string
  /** Called when the per-row sparkle icon is clicked. */
  onSuggestRow?: (index: number) => void
  /** True iff a per-row suggestion is in flight. Cross-mode gate for generate-all. */
  suggestingAnyRow?: boolean
  /** True iff the given row's per-row suggestion is in flight. */
  isSuggestingRow?: (index: number) => boolean
  /** True iff the given row's sparkle should be disabled (row complete OR no grounding). */
  rowSuggestDisabled?: (index: number) => boolean
  /** State-aware tooltip for the given row's sparkle. */
  rowSuggestTooltip?: (index: number) => string
}

/**
 * ArgumentsBuilder provides UI for managing prompt arguments.
 *
 * Features:
 * - Add new arguments
 * - Edit argument name, description, and required flag
 * - Remove arguments
 * - Reorder arguments with up/down buttons
 * - AI sparkle icons:
 *   - Header: generate-all sparkle that proposes entries for every new
 *     placeholder in the template.
 *   - Per row: a sparkle placed next to the "Required" checkbox that
 *     fills in whichever fields on that row are blank.
 *
 * Cross-mode serialization: while generate-all is in flight, per-row
 * sparkles are disabled. While any per-row sparkle is in flight, the
 * generate-all sparkle is disabled. Prevents index-shift races.
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
  onSuggestRow,
  suggestingAnyRow = false,
  isSuggestingRow,
  rowSuggestDisabled,
  rowSuggestTooltip,
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
            <MaybeTooltip
              content={computeGenerateAllTooltip({
                disabled,
                isSuggestingAll,
                suggestingAnyRow,
                suggestAllDisabled,
                suggestAllTooltip,
              })}
              compact
              delay={500}
              position="left"
            >
              <button
                type="button"
                onClick={onSuggestAll}
                disabled={suggestAllDisabled || isSuggestingAll || suggestingAnyRow || disabled}
                className="btn-icon text-gray-300 hover:text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
                aria-label="Generate arguments from template"
              >
                {isSuggestingAll ? (
                  <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                  <SparklesIcon className="h-4 w-4" />
                )}
              </button>
            </MaybeTooltip>
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
                  onSuggestRow={showAIIcons ? onSuggestRow : undefined}
                  isSuggestingThisRow={isSuggestingRow?.(index) ?? false}
                  suggestingAnyRow={suggestingAnyRow}
                  isSuggestingAll={isSuggestingAll}
                  rowDisabled={rowSuggestDisabled?.(index) ?? false}
                  rowTooltip={rowSuggestTooltip?.(index) ?? ''}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
