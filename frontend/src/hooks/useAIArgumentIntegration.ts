/**
 * Composition hook that wires useArgumentSuggestions into the Prompt component.
 *
 * Returns props to spread onto ArgumentsBuilder, keeping AI wiring out of
 * the main component.
 */
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useArgumentSuggestions } from './useArgumentSuggestions'
import { getRowBlanks } from './argumentBlanks'
import type { PromptArgument } from '../types'

interface PromptLikeState {
  content: string
  arguments: PromptArgument[]
}

interface ArgumentSuggestionProps {
  /** Generate-all handler. */
  onSuggestAll: () => void
  isSuggestingAll: boolean
  suggestAllDisabled: boolean
  suggestAllTooltip: string
  /** Per-row refine handler. */
  onSuggestRow: (index: number) => void
  /** True while any per-row request is in flight. Used for cross-mode gating. */
  suggestingAnyRow: boolean
  /** True iff this specific row's request is in flight. */
  isSuggestingRow: (index: number) => boolean
  /** True iff this row's sparkle should be disabled (no blank fields OR no grounding). */
  rowSuggestDisabled: (index: number) => boolean
  /** State-aware tooltip string for this row's sparkle. Empty string → no custom tooltip. */
  rowSuggestTooltip: (index: number) => string
}

interface UseAIArgumentIntegrationReturn {
  /** Props to spread onto ArgumentsBuilder. Undefined when AI not available (hides icons). */
  argumentSuggestProps: ArgumentSuggestionProps | undefined
}

export function useAIArgumentIntegration<T extends PromptLikeState>(
  current: T,
  setCurrent: Dispatch<SetStateAction<T>>,
  available: boolean,
): UseAIArgumentIntegrationReturn {
  const {
    isGeneratingAll,
    suggestingIndex,
    suggestingAnyRow,
    suggestAll,
    suggestRowFields,
  } = useArgumentSuggestions({ available })

  const hasContent = current.content.trim().length > 0
  // Quick check for {{ placeholder }} — skip the request entirely if none exist.
  // The backend would return early too, but this avoids a wasted network
  // request and rate-limit consumption.
  //
  // Keep this regex in sync with `_JINJA2_PLACEHOLDER_RE` in
  // `backend/src/services/llm_prompts.py` — they define the same placeholder
  // shape, and extending one (e.g. to allow hyphens) requires updating both.
  const hasPlaceholders = /\{\{\s*\w+\s*\}\}/.test(current.content)

  const handleSuggestAll = useCallback((): void => {
    suggestAll(current.content, current.arguments, (newArgs) => {
      setCurrent((prev) => ({
        ...prev,
        arguments: [
          ...prev.arguments,
          ...newArgs.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
          })),
        ],
      }))
    })
  }, [current.content, current.arguments, suggestAll, setCurrent])

  const handleSuggestRow = useCallback((index: number): void => {
    suggestRowFields(
      index,
      current.content || null,
      current.arguments,
      (idx, suggestion, targetFields) => {
        setCurrent((prev) => {
          const args = [...prev.arguments]
          const row = args[idx]
          // Row removed mid-flight → discard the suggestion silently.
          if (!row) return prev
          const patched = { ...row }
          // Patch only fields that (a) the caller asked to generate AND
          // (b) are still blank in live state at resolution time.
          if (targetFields.includes('name') && !row.name.trim()) {
            patched.name = suggestion.name
          }
          if (targetFields.includes('description') && !(row.description?.trim())) {
            patched.description = suggestion.description
          }
          // `required` is template-inferred only in the two-field regenerate-
          // from-blank path. Apply only when both fields were requested AND
          // the live row is still observably blank — otherwise the user has
          // edited into the row since, so `required` inference is no longer
          // meaningful and we preserve the user's manual choice.
          if (
            targetFields.length === 2
            && !row.name.trim()
            && !(row.description?.trim())
          ) {
            patched.required = suggestion.required
          }
          args[idx] = patched
          return { ...prev, arguments: args }
        })
      },
    )
  }, [current.content, current.arguments, suggestRowFields, setCurrent])

  if (!available) {
    return { argumentSuggestProps: undefined }
  }

  return {
    argumentSuggestProps: {
      onSuggestAll: handleSuggestAll,
      isSuggestingAll: isGeneratingAll,
      suggestAllDisabled: !hasContent || !hasPlaceholders,
      suggestAllTooltip: !hasContent
        ? 'Add prompt content to enable AI argument generation'
        : !hasPlaceholders
          ? 'No {{ placeholders }} found in template'
          : 'Generate arguments from template',
      onSuggestRow: handleSuggestRow,
      suggestingAnyRow,
      isSuggestingRow: (index: number) => suggestingIndex === index,
      rowSuggestDisabled: (index: number) => computeRowDisabled(
        current.arguments[index], hasContent,
      ),
      rowSuggestTooltip: (index: number) => computeRowTooltip(
        current.arguments[index], hasContent,
      ),
    },
  }
}

// ---------------------------------------------------------------------------
// Row-level disable/tooltip helpers
// ---------------------------------------------------------------------------

/** Matches the tooltip strings in computeRowTooltip — exported for test parity. */
export const ROW_TOOLTIPS = {
  suggestName: 'Suggest name',
  suggestDescription: 'Suggest description',
  suggestBoth: 'Suggest name and description',
  rowComplete: 'Clear name or description to generate a suggestion',
  noGrounding: 'Add a name, description, or prompt content to generate a suggestion',
} as const

function computeRowDisabled(
  row: PromptArgument | undefined,
  hasContent: boolean,
): boolean {
  if (!row) return true
  const { nameBlank, descBlank } = getRowBlanks(row)
  if (!nameBlank && !descBlank) return true  // row complete
  if (nameBlank && descBlank && !hasContent) return true  // no grounding
  return false
}

function computeRowTooltip(
  row: PromptArgument | undefined,
  hasContent: boolean,
): string {
  if (!row) return ''
  const { nameBlank, descBlank } = getRowBlanks(row)
  // Priority: row complete → no grounding → enabled (state-aware).
  // In-flight / globally-disabled cases are handled at the component layer;
  // they return empty string so the component inherits default behavior.
  if (!nameBlank && !descBlank) return ROW_TOOLTIPS.rowComplete
  if (nameBlank && descBlank && !hasContent) return ROW_TOOLTIPS.noGrounding
  if (nameBlank && descBlank) return ROW_TOOLTIPS.suggestBoth
  if (nameBlank) return ROW_TOOLTIPS.suggestName
  return ROW_TOOLTIPS.suggestDescription
}
