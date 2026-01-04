/**
 * Prompt detail page - handles view, edit, and create modes.
 *
 * Routes:
 * - /app/prompts/:id - View mode
 * - /app/prompts/:id/edit - Edit mode
 * - /app/prompts/new - Create new prompt
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { PromptView } from '../components/PromptView'
import { PromptEditor } from '../components/PromptEditor'
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
import type { Prompt, PromptCreate, PromptUpdate } from '../types'
import { getApiErrorMessage } from '../utils'

type PageMode = 'view' | 'edit' | 'create'
type PromptViewState = 'active' | 'archived' | 'deleted'

/**
 * Determine the view state of a prompt based on its data.
 */
function getPromptViewState(prompt: Prompt): PromptViewState {
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

  // Determine mode from route
  const mode: PageMode = useMemo(() => {
    if (!id || id === 'new') return 'create'
    if (location.pathname.endsWith('/edit')) return 'edit'
    return 'view'
  }, [id, location.pathname])

  const promptId = mode !== 'create' ? parseInt(id!, 10) : undefined
  const isValidId = promptId !== undefined && !isNaN(promptId)

  // State
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [isLoading, setIsLoading] = useState(mode !== 'create')
  const [error, setError] = useState<string | null>(null)

  // Get navigation state
  const locationState = location.state as { initialTags?: string[] } | undefined
  const { selectedTags, addTag } = useTagFilterStore()
  const initialTags = locationState?.initialTags ?? (selectedTags.length > 0 ? selectedTags : undefined)

  // Navigation
  const { navigateBack, returnTo } = useReturnNavigation()

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

  // Fetch prompt on mount (for view/edit modes)
  useEffect(() => {
    if (mode === 'create') {
      setIsLoading(false)
      return
    }

    if (!isValidId) {
      setError('Invalid prompt ID')
      setIsLoading(false)
      return
    }

    const loadPrompt = async (): Promise<void> => {
      setIsLoading(true)
      setError(null)
      try {
        const fetchedPrompt = await fetchPrompt(promptId!)
        setPrompt(fetchedPrompt)
        // Track usage when viewing
        if (mode === 'view') {
          trackPromptUsage(promptId!)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load prompt')
      } finally {
        setIsLoading(false)
      }
    }

    loadPrompt()
  }, [mode, promptId, isValidId, fetchPrompt, trackPromptUsage])

  // Navigation helpers
  const navigateToView = useCallback((promptId: number): void => {
    // Preserve returnTo state when navigating to view
    navigate(`/app/prompts/${promptId}`, { state: { returnTo } })
  }, [navigate, returnTo])

  const handleBack = useCallback((): void => {
    navigateBack()
  }, [navigateBack])

  const handleEdit = useCallback((): void => {
    if (promptId) {
      // Preserve returnTo state when navigating to edit
      navigate(`/app/prompts/${promptId}/edit`, { state: { returnTo } })
    }
  }, [promptId, navigate, returnTo])

  const handleTagClick = useCallback((tag: string): void => {
    // Navigate to content list with tag filter
    addTag(tag)
    navigateBack()
  }, [addTag, navigateBack])

  // Action handlers
  const handleSubmitCreate = useCallback(
    async (data: PromptCreate | PromptUpdate): Promise<void> => {
      try {
        await createMutation.mutateAsync(data as PromptCreate)
        // Navigate back to the originating list if available
        navigateBack()
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Failed to create prompt'))
        throw err
      }
    },
    [createMutation, navigateBack]
  )

  const handleSubmitUpdate = useCallback(
    async (data: PromptCreate | PromptUpdate): Promise<void> => {
      if (!promptId) return

      try {
        const updatedPrompt = await updateMutation.mutateAsync({
          id: promptId,
          data: data as PromptUpdate,
        })
        setPrompt(updatedPrompt)
        navigateToView(promptId)
      } catch (err) {
        toast.error(getApiErrorMessage(err, 'Failed to save prompt'))
        throw err
      }
    },
    [promptId, updateMutation, navigateToView]
  )

  const handleCancel = useCallback((): void => {
    if (mode === 'create') {
      navigateBack()
    } else if (promptId) {
      navigateToView(promptId)
    }
  }, [mode, promptId, navigateBack, navigateToView])

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!promptId) return
    try {
      const archivedPrompt = await archiveMutation.mutateAsync(promptId)
      setPrompt(archivedPrompt)
    } catch {
      toast.error('Failed to archive prompt')
    }
  }, [promptId, archiveMutation])

  const handleUnarchive = useCallback(async (): Promise<void> => {
    if (!promptId) return
    try {
      const unarchivedPrompt = await unarchiveMutation.mutateAsync(promptId)
      setPrompt(unarchivedPrompt)
    } catch {
      toast.error('Failed to unarchive prompt')
    }
  }, [promptId, unarchiveMutation])

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
    } catch {
      toast.error('Failed to restore prompt')
    }
  }, [promptId, restoreMutation])

  // Render loading state
  if (isLoading) {
    return <LoadingSpinnerCentered label="Loading prompt..." />
  }

  // Render error state
  if (error) {
    return <ErrorState message={error} onRetry={() => navigate(0)} />
  }

  // Render create mode
  if (mode === 'create') {
    return (
      <div className={`flex flex-col h-full w-full ${fullWidthLayout ? '' : 'max-w-4xl'}`}>
        <PromptEditor
          tagSuggestions={tagSuggestions}
          onSubmit={handleSubmitCreate}
          onCancel={handleCancel}
          isSubmitting={createMutation.isPending}
          initialTags={initialTags}
        />
      </div>
    )
  }

  // Render view/edit modes (requires prompt to be loaded)
  if (!prompt) {
    return <ErrorState message="Prompt not found" />
  }

  // Edit mode
  if (mode === 'edit') {
    return (
      <div className={`flex flex-col h-full w-full ${fullWidthLayout ? '' : 'max-w-4xl'}`}>
        <PromptEditor
          prompt={prompt}
          tagSuggestions={tagSuggestions}
          onSubmit={handleSubmitUpdate}
          onCancel={handleCancel}
          isSubmitting={updateMutation.isPending}
          onArchive={viewState === 'active' ? handleArchive : undefined}
          onDelete={handleDelete}
        />
      </div>
    )
  }

  // View mode
  return (
    <PromptView
      prompt={prompt}
      view={viewState}
      fullWidth={fullWidthLayout}
      onEdit={viewState !== 'deleted' ? handleEdit : undefined}
      onArchive={viewState === 'active' ? handleArchive : undefined}
      onUnarchive={viewState === 'archived' ? handleUnarchive : undefined}
      onDelete={handleDelete}
      onRestore={viewState === 'deleted' ? handleRestore : undefined}
      onTagClick={handleTagClick}
      onBack={handleBack}
    />
  )
}
