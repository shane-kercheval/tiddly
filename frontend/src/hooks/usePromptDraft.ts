/**
 * Hook for managing prompt draft autosave functionality.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { PromptArgument } from '../types'

/** Key prefix for localStorage draft storage */
const DRAFT_KEY_PREFIX = 'prompt_draft_'

/** Auto-save interval in milliseconds */
const AUTO_SAVE_INTERVAL = 30000

export interface DraftData {
  name: string
  title: string
  description: string
  content: string
  arguments: PromptArgument[]
  tags: string[]
  savedAt: number
}

export interface FormState {
  name: string
  title: string
  description: string
  content: string
  arguments: PromptArgument[]
  tags: string[]
}

interface OriginalValues {
  name: string
  title: string
  description: string
  content: string
  arguments: PromptArgument[]
  tags: string[]
}

interface UsePromptDraftOptions {
  /** The prompt ID (undefined for new prompts) */
  promptId?: string
  /** Current form state */
  formState: FormState
  /** Original values to compare against for dirty detection */
  originalValues: OriginalValues
  /** Callback to update form state when draft is restored */
  onRestore: (data: DraftData) => void
}

interface UsePromptDraftResult {
  /** Whether there's an unsaved draft available */
  hasDraft: boolean
  /** Whether the form has unsaved changes */
  isDirty: boolean
  /** Restore the saved draft */
  restoreDraft: () => void
  /** Discard the saved draft */
  discardDraft: () => void
  /** Clear the draft (call after successful save) */
  clearDraft: () => void
}

/**
 * Get the localStorage key for a prompt draft.
 */
function getDraftKey(promptId?: string): string {
  return promptId ? `${DRAFT_KEY_PREFIX}${promptId}` : `${DRAFT_KEY_PREFIX}new`
}

/**
 * Load draft from localStorage if available.
 */
function loadDraftFromStorage(promptId?: string): DraftData | null {
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
function saveDraftToStorage(promptId: string | undefined, data: DraftData): void {
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
function clearDraftFromStorage(promptId?: string): void {
  try {
    const key = getDraftKey(promptId)
    localStorage.removeItem(key)
  } catch {
    // Ignore errors
  }
}

/**
 * Hook for managing prompt draft autosave.
 *
 * Features:
 * - Auto-saves every 30 seconds when form is dirty
 * - Detects existing drafts on mount
 * - Provides restore/discard functionality
 */
export function usePromptDraft({
  promptId,
  formState,
  originalValues,
  onRestore,
}: UsePromptDraftOptions): UsePromptDraftResult {
  const draftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check for existing draft on mount
  const [hasDraft, setHasDraft] = useState(() => {
    const draft = loadDraftFromStorage(promptId)
    if (!draft) return false

    // Only show prompt if draft is different from original values
    // Use same comparison pattern as isDirty for consistency
    const isDifferent = promptId
      ? draft.name !== originalValues.name ||
        draft.title !== originalValues.title ||
        draft.description !== originalValues.description ||
        draft.content.length !== originalValues.content.length ||
        draft.content !== originalValues.content ||
        draft.tags.length !== originalValues.tags.length ||
        draft.tags.some((tag, i) => tag !== originalValues.tags[i]) ||
        draft.arguments.length !== originalValues.arguments.length ||
        JSON.stringify(draft.arguments) !== JSON.stringify(originalValues.arguments)
      : draft.name || draft.title || draft.description || draft.content ||
        draft.arguments.length > 0 || draft.tags.length > 0

    return Boolean(isDifferent)
  })

  // Compute dirty state - optimized to match Note.tsx/Bookmark.tsx pattern
  // Check lengths first for quick short-circuit
  const isDirty =
    formState.name !== originalValues.name ||
    formState.title !== originalValues.title ||
    formState.description !== originalValues.description ||
    formState.content.length !== originalValues.content.length ||
    formState.content !== originalValues.content ||
    formState.tags.length !== originalValues.tags.length ||
    formState.tags.some((tag, i) => tag !== originalValues.tags[i]) ||
    formState.arguments.length !== originalValues.arguments.length ||
    JSON.stringify(formState.arguments) !== JSON.stringify(originalValues.arguments)

  // Auto-save draft when form is dirty
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
        name: formState.name,
        title: formState.title,
        description: formState.description,
        content: formState.content,
        arguments: formState.arguments,
        tags: formState.tags,
        savedAt: Date.now(),
      }
      saveDraftToStorage(promptId, draftData)
    }, AUTO_SAVE_INTERVAL)

    return () => {
      if (draftTimerRef.current) {
        clearInterval(draftTimerRef.current)
      }
    }
  }, [formState, promptId, isDirty])

  const restoreDraft = useCallback((): void => {
    const draft = loadDraftFromStorage(promptId)
    if (draft) {
      onRestore(draft)
    }
    setHasDraft(false)
  }, [promptId, onRestore])

  const discardDraft = useCallback((): void => {
    clearDraftFromStorage(promptId)
    setHasDraft(false)
  }, [promptId])

  const clearDraft = useCallback((): void => {
    clearDraftFromStorage(promptId)
  }, [promptId])

  return {
    hasDraft,
    isDirty,
    restoreDraft,
    discardDraft,
    clearDraft,
  }
}
