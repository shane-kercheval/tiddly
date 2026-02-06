/**
 * Prompt detail page - handles create and edit modes.
 *
 * Routes:
 * - /app/prompts/:id - View/edit prompt (unified component)
 * - /app/prompts/new - Create new prompt
 */
import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Prompt as PromptComponent, SaveError } from '../components/Prompt'
import { HistorySidebar } from '../components/HistorySidebar'
import { LoadingSpinnerCentered, ErrorState } from '../components/ui'
import { usePrompts } from '../hooks/usePrompts'
import { useReturnNavigation } from '../hooks/useReturnNavigation'
import {
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  useRestorePrompt,
  useArchivePrompt,
  useUnarchivePrompt,
} from '../hooks/usePromptMutations'
import { useTagsStore } from '../stores/tagsStore'
import { useTagFilterStore } from '../stores/tagFilterStore'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import type { Prompt as PromptType, PromptCreate, PromptUpdate } from '../types'

type PromptViewState = 'active' | 'archived' | 'deleted'

/**
 * Determine the view state of a prompt based on its data.
 */
function getPromptViewState(prompt: PromptType): PromptViewState {
  if (prompt.deleted_at) return 'deleted'
  if (prompt.archived_at) return 'archived'
  return 'active'
}

/**
 * PromptDetail handles viewing, editing, and creating prompts.
 */
export function PromptDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  // Determine if this is create mode
  const isCreate = !id || id === 'new'
  const promptId = !isCreate ? id : undefined
  const isValidId = promptId !== undefined && promptId.length > 0

  // State
  const [prompt, setPrompt] = useState<PromptType | null>(null)
  const [isLoading, setIsLoading] = useState(!isCreate)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // Get navigation state
  const locationState = location.state as { initialTags?: string[]; prompt?: PromptType } | undefined
  const { selectedTags } = useTagFilterStore()
  const initialTags = locationState?.initialTags ?? (selectedTags.length > 0 ? selectedTags : undefined)
  // Prompt passed via navigation state (used after create to avoid refetch)
  const passedPrompt = locationState?.prompt

  // Navigation
  const { navigateBack } = useReturnNavigation()
  const queryClient = useQueryClient()

  // Hooks
  const { fetchPrompt, trackPromptUsage } = usePrompts()
  const { tags: tagSuggestions } = useTagsStore()
  const fullWidthLayout = useUIPreferencesStore((state) => state.fullWidthLayout)
  const createMutation = useCreatePrompt()
  const updateMutation = useUpdatePrompt()
  const deleteMutation = useDeletePrompt()
  const restoreMutation = useRestorePrompt()
  const archiveMutation = useArchivePrompt()
  const unarchiveMutation = useUnarchivePrompt()

  // Derive view state from prompt
  const viewState: PromptViewState = prompt ? getPromptViewState(prompt) : 'active'

  // Fetch prompt on mount (for existing prompts)
  useEffect(() => {
    if (isCreate) {
      setIsLoading(false)
      return
    }

    if (!isValidId) {
      setError('Invalid prompt ID')
      setIsLoading(false)
      return
    }

    // If prompt was passed via navigation state (after create), use it directly
    if (passedPrompt && passedPrompt.id === promptId) {
      setPrompt(passedPrompt)
      setIsLoading(false)
      trackPromptUsage(promptId!)
      return
    }

    const loadPrompt = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const fetchedPrompt = await fetchPrompt(promptId!)
        setPrompt(fetchedPrompt)
        // Track usage when viewing
        trackPromptUsage(promptId!)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load prompt')
      } finally {
        setIsLoading(false)
      }
    }

    loadPrompt()
  }, [isCreate, promptId, isValidId, fetchPrompt, trackPromptUsage, passedPrompt])

  // Navigation helper
  const handleBack = useCallback((): void => {
    navigateBack()
  }, [navigateBack])

  // Helper to check if error is a 409 NAME_CONFLICT and throw SaveError
  // Returns true if it's a version conflict (component handles with ConflictDialog)
  const handleNameConflict = (err: unknown): boolean => {
    if (err && typeof err === 'object' && 'response' in err) {
      const axiosError = err as {
        response?: {
          status?: number
          data?: {
            detail?: string | { message?: string; error_code?: string; error?: string }
          }
        }
      }
      if (axiosError.response?.status === 409) {
        const detail = axiosError.response.data?.detail
        // Version conflict (optimistic locking) - let component handle with ConflictDialog
        if (typeof detail === 'object' && detail?.error === 'conflict') {
          return true
        }
        // Name conflict - throw SaveError for field-specific error display
        let message = 'A prompt with this name already exists'
        if (typeof detail === 'string') {
          message = detail
        } else if (typeof detail === 'object' && detail?.message) {
          message = detail.message
        }
        throw new SaveError(message, { name: message })
      }
    }
    return false
  }

  // Action handlers
  const handleSave = useCallback(
    async (data: PromptCreate | PromptUpdate): Promise<void> => {
      if (isCreate) {
        try {
          const createdPrompt = await createMutation.mutateAsync(data as PromptCreate)
          // Navigate to the new prompt's URL, passing the prompt to avoid refetch
          navigate(`/app/prompts/${createdPrompt.id}`, {
            replace: true,
            state: { prompt: createdPrompt },
          })
        } catch (err) {
          handleNameConflict(err)
          const message = err instanceof Error ? err.message : 'Failed to create prompt'
          toast.error(message)
          throw err
        }
      } else if (promptId) {
        try {
          const updatedPrompt = await updateMutation.mutateAsync({
            id: promptId,
            data: data as PromptUpdate,
          })
          setPrompt(updatedPrompt)
          // Refresh history sidebar if open (use partial key to match any params)
          if (showHistory) {
            queryClient.invalidateQueries({ queryKey: ['history', 'prompt', promptId] })
          }
        } catch (err) {
          // Returns true for version conflict - component handles with ConflictDialog
          if (handleNameConflict(err)) {
            throw err
          }
          const message = err instanceof Error ? err.message : 'Failed to save prompt'
          toast.error(message)
          throw err
        }
      }
    },
    [isCreate, promptId, createMutation, updateMutation, navigate, showHistory, queryClient]
  )

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!promptId) return
    try {
      const archivedPrompt = await archiveMutation.mutateAsync(promptId)
      setPrompt(archivedPrompt)
      navigateBack()
    } catch {
      toast.error('Failed to archive prompt')
    }
  }, [promptId, archiveMutation, navigateBack])

  const handleUnarchive = useCallback(async (): Promise<void> => {
    if (!promptId) return
    try {
      const unarchivedPrompt = await unarchiveMutation.mutateAsync(promptId)
      setPrompt(unarchivedPrompt)
      navigateBack()
    } catch {
      toast.error('Failed to unarchive prompt')
    }
  }, [promptId, unarchiveMutation, navigateBack])

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!promptId) return
    try {
      const isPermanent = viewState === 'deleted'
      await deleteMutation.mutateAsync({ id: promptId, permanent: isPermanent })
      navigateBack()
    } catch {
      toast.error('Failed to delete prompt')
    }
  }, [promptId, viewState, deleteMutation, navigateBack])

  const handleRestore = useCallback(async (): Promise<void> => {
    if (!promptId) return
    try {
      const restoredPrompt = await restoreMutation.mutateAsync(promptId)
      setPrompt(restoredPrompt)
      navigateBack()
    } catch {
      toast.error('Failed to restore prompt')
    }
  }, [promptId, restoreMutation, navigateBack])

  // Refresh handler for stale check - returns true on success, false on failure
  const handleRefresh = useCallback(async (): Promise<PromptType | null> => {
    if (!promptId) return null
    try {
      // skipCache: true ensures we bypass Safari's aggressive caching
      const refreshedPrompt = await fetchPrompt(promptId, { skipCache: true })
      setPrompt(refreshedPrompt)
      return refreshedPrompt
    } catch {
      toast.error('Failed to refresh prompt')
      return null
    }
  }, [promptId, fetchPrompt])

  // History sidebar handlers
  const handleShowHistory = useCallback((): void => {
    setShowHistory(true)
  }, [])

  const handleHistoryReverted = useCallback(async (): Promise<void> => {
    // Refresh the prompt after a revert to show the restored content
    if (promptId) {
      const refreshedPrompt = await fetchPrompt(promptId, { skipCache: true })
      setPrompt(refreshedPrompt)
      toast.success('Prompt restored to previous version')
    }
  }, [promptId, fetchPrompt])

  // Render loading state
  if (isLoading) {
    return <LoadingSpinnerCentered label="Loading prompt..." />
  }

  // Render error state
  if (error) {
    return <ErrorState message={error} onRetry={() => navigate(0)} />
  }

  // Render create mode
  if (isCreate) {
    return (
      <PromptComponent
        key="new"
        tagSuggestions={tagSuggestions}
        onSave={handleSave}
        onClose={handleBack}
        isSaving={createMutation.isPending}
        initialTags={initialTags}
        fullWidth={fullWidthLayout}
      />
    )
  }

  // Render existing prompt (requires prompt to be loaded)
  // Use passedPrompt if prompt state hasn't been set yet (avoids flash during navigation)
  const effectivePrompt = prompt ?? passedPrompt
  if (!effectivePrompt) {
    return <ErrorState message="Prompt not found" />
  }

  return (
    <>
      <PromptComponent
        key={effectivePrompt.id}
        prompt={effectivePrompt}
        tagSuggestions={tagSuggestions}
        onSave={handleSave}
        onClose={handleBack}
        isSaving={updateMutation.isPending}
        onArchive={viewState === 'active' ? handleArchive : undefined}
        onUnarchive={viewState === 'archived' ? handleUnarchive : undefined}
        onDelete={handleDelete}
        onRestore={viewState === 'deleted' ? handleRestore : undefined}
        viewState={viewState}
        fullWidth={fullWidthLayout}
        onRefresh={handleRefresh}
        onShowHistory={handleShowHistory}
      />
      {showHistory && promptId && (
        <HistorySidebar
          entityType="prompt"
          entityId={promptId}
          onClose={() => setShowHistory(false)}
          onReverted={handleHistoryReverted}
        />
      )}
    </>
  )
}
