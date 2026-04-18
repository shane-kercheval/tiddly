/**
 * Shared "is this row field blank?" semantic.
 *
 * Used by both `useArgumentSuggestions` (to derive `target_fields` at call
 * time) and `useAIArgumentIntegration` (to compute `rowSuggestDisabled` /
 * `rowSuggestTooltip`). Keeping a single source of truth prevents drift
 * between "which fields will be sent" and "which tooltip is shown."
 *
 * Whitespace-only counts as blank — matches the backend's `mode="before"`
 * normalization (ArgumentInput normalizer strips whitespace and converts
 * empty/whitespace-only to None).
 */
import type { PromptArgument } from '../types'

export interface RowBlanks {
  nameBlank: boolean
  descBlank: boolean
}

export function getRowBlanks(arg: PromptArgument | undefined): RowBlanks {
  return {
    nameBlank: !arg?.name.trim(),
    descBlank: !(arg?.description?.trim()),
  }
}
