/**
 * Zustand store for AI configuration — per-use-case API keys and model overrides.
 * Persisted to localStorage. API keys are never sent to our backend for storage —
 * they're forwarded via X-LLM-Api-Key header on each AI request.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Use cases matching the backend AIUseCase enum values. */
export type AIUseCase = 'suggestions' | 'transform' | 'auto_complete' | 'chat'

/** Use cases that have shipped frontend features. Others show "Coming soon". */
export const ACTIVE_USE_CASES = new Set<AIUseCase>(['suggestions'])

/** All use cases in display order. */
export const ALL_USE_CASES: AIUseCase[] = ['suggestions', 'transform', 'auto_complete', 'chat']

/** Per-use-case configuration. */
export interface UseCaseConfig {
  apiKey: string | null
  model: string | null  // null = platform default
}

const DEFAULT_CONFIG: UseCaseConfig = { apiKey: null, model: null }

function defaultConfigs(): Record<AIUseCase, UseCaseConfig> {
  return {
    suggestions: { ...DEFAULT_CONFIG },
    transform: { ...DEFAULT_CONFIG },
    auto_complete: { ...DEFAULT_CONFIG },
    chat: { ...DEFAULT_CONFIG },
  }
}

interface AIState {
  useCaseConfigs: Record<AIUseCase, UseCaseConfig>
}

interface AIActions {
  setApiKey: (useCase: AIUseCase, key: string) => void
  clearApiKey: (useCase: AIUseCase) => void
  clearAllKeys: () => void
  setModel: (useCase: AIUseCase, modelId: string) => void
  clearModel: (useCase: AIUseCase) => void
  getConfig: (useCase: AIUseCase) => UseCaseConfig
}

type AIStore = AIState & AIActions

export const useAIStore = create<AIStore>()(
  persist(
    (set, get) => ({
      useCaseConfigs: defaultConfigs(),

      setApiKey: (useCase: AIUseCase, key: string) => {
        set((state) => ({
          useCaseConfigs: {
            ...state.useCaseConfigs,
            [useCase]: { ...state.useCaseConfigs[useCase], apiKey: key },
          },
        }))
      },

      clearApiKey: (useCase: AIUseCase) => {
        set((state) => ({
          useCaseConfigs: {
            ...state.useCaseConfigs,
            [useCase]: { apiKey: null, model: null },
          },
        }))
      },

      clearAllKeys: () => {
        set({ useCaseConfigs: defaultConfigs() })
      },

      setModel: (useCase: AIUseCase, modelId: string) => {
        set((state) => ({
          useCaseConfigs: {
            ...state.useCaseConfigs,
            [useCase]: { ...state.useCaseConfigs[useCase], model: modelId },
          },
        }))
      },

      clearModel: (useCase: AIUseCase) => {
        set((state) => ({
          useCaseConfigs: {
            ...state.useCaseConfigs,
            [useCase]: { ...state.useCaseConfigs[useCase], model: null },
          },
        }))
      },

      getConfig: (useCase: AIUseCase) => {
        return get().useCaseConfigs[useCase] ?? DEFAULT_CONFIG
      },
    }),
    {
      name: 'ai-config',
    },
  ),
)
