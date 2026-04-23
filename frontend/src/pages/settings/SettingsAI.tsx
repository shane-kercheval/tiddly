/**
 * AI Configuration settings page.
 *
 * Shows AI feature descriptions to all tiers.
 * Configuration (quota, use case rows) only shown when AI is available for the user's tier.
 * API keys are stored in browser localStorage only — never persisted server-side.
 */
import { useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useAIStore, ACTIVE_USE_CASES, ALL_USE_CASES } from '../../stores/aiStore'
import type { AIUseCase } from '../../stores/aiStore'
import { fetchAIModels, fetchAIHealth, validateKey } from '../../services/aiApi'
import { useAIAvailability, aiHealthKeys } from '../../hooks/useAIAvailability'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from '../../components/icons'
import { useAuthStatus } from '../../hooks/useAuthStatus'
import type { AIModelsResponse } from '../../types'

/** Feature descriptions for the reference table — visible to all tiers. */
const AI_FEATURES = [
  {
    name: 'Tag suggestions',
    description: 'Suggests relevant tags based on your content, title, and URL.',
    location: 'Tag input on any item',
  },
  {
    name: 'Metadata generation',
    description: 'Generates titles and descriptions from your content.',
    location: 'Sparkle icon on title and description fields',
  },
  {
    name: 'Relationship discovery',
    description: 'Finds related bookmarks, notes, and prompts based on content similarity.',
    location: 'Linked content input on any item',
  },
  {
    name: 'Argument suggestions',
    description: 'Generates names and descriptions for prompt template arguments.',
    location: 'Prompt editor arguments section',
  },
]

/** Human-readable labels with descriptions for each use case. */
const USE_CASE_INFO: Record<AIUseCase, { label: string; description: string }> = {
  suggestions: { label: 'Suggestions', description: 'Tags, metadata, and relationships' },
  transform: { label: 'Transform', description: 'Improve, summarize, and explain' },
  auto_complete: { label: 'Auto-Complete', description: 'Editor auto-completion' },
  chat: { label: 'Chat', description: 'Conversational AI assistant' },
}

// ---------------------------------------------------------------------------
// Use case row component
// ---------------------------------------------------------------------------

interface UseCaseRowProps {
  useCase: AIUseCase
  modelsData: AIModelsResponse | undefined
}

function UseCaseRow({ useCase, modelsData }: UseCaseRowProps): ReactNode {
  const isActive = ACTIVE_USE_CASES.has(useCase)
  const config = useAIStore((s) => s.useCaseConfigs[useCase])
  const setApiKey = useAIStore((s) => s.setApiKey)
  const clearApiKey = useAIStore((s) => s.clearApiKey)
  const setModel = useAIStore((s) => s.setModel)
  const clearModel = useAIStore((s) => s.clearModel)

  const [expanded, setExpanded] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  const defaultModelId = modelsData?.defaults[useCase] ?? ''
  const currentModelId = config.model ?? defaultModelId
  const hasKey = !!config.apiKey
  const hasKeyInput = !!(config.apiKey?.trim())
  const info = USE_CASE_INFO[useCase]

  const handleKeyChange = useCallback((value: string) => {
    const trimmed = value.trim()
    if (trimmed) {
      setApiKey(useCase, trimmed)
    } else {
      clearApiKey(useCase)
    }
    setTestStatus('idle')
    setTestError(null)
  }, [useCase, setApiKey, clearApiKey])

  const handleClear = useCallback(() => {
    clearApiKey(useCase)
    setTestStatus('idle')
    setTestError(null)
    setShowKey(false)
  }, [useCase, clearApiKey])

  const handleTestConnection = useCallback(async () => {
    if (!hasKey) return
    setTestStatus('testing')
    setTestError(null)
    try {
      const result = await validateKey(useCase)
      if (result.valid) {
        setTestStatus('success')
      } else {
        setTestStatus('error')
        setTestError(result.error ?? 'Key rejected by provider')
      }
    } catch {
      setTestStatus('error')
      setTestError('Connection failed. Check your key and try again.')
    }
  }, [useCase, hasKey])

  const handleModelChange = useCallback((modelId: string) => {
    if (modelId === defaultModelId) {
      clearModel(useCase)
    } else {
      setModel(useCase, modelId)
    }
  }, [useCase, defaultModelId, setModel, clearModel])

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Row header */}
      <button
        type="button"
        onClick={() => isActive && setExpanded(!expanded)}
        disabled={!isActive}
        className={`flex w-full items-center justify-between gap-4 p-4 text-left ${
          isActive ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
        }`}
        aria-expanded={isActive ? expanded : undefined}
        aria-label={`${info.label} configuration`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-900">
              {info.label}
            </h3>
            {!isActive && (
              <span className="text-xs text-gray-400">Coming soon</span>
            )}
          </div>
          <p className="text-xs text-gray-500">{info.description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isActive && currentModelId && (
            <span className="text-xs text-gray-400 font-mono">{currentModelId}</span>
          )}
          {isActive && (
            <div className="text-gray-400">
              {expanded
                ? <ChevronDownIcon className="h-4 w-4" />
                : <ChevronRightIcon className="h-4 w-4" />}
            </div>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {isActive && expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50 p-4 space-y-4">
          {/* Model selection */}
          <div>
            <label
              htmlFor={`model-${useCase}`}
              className="block text-xs font-medium text-gray-500 mb-1"
            >
              Model
            </label>
            {hasKeyInput ? (
              <select
                id={`model-${useCase}`}
                value={currentModelId}
                onChange={(e) => handleModelChange(e.target.value)}
                className="select"
                aria-label={`Model for ${info.label}`}
              >
                {modelsData?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
            ) : (
              <p id={`model-${useCase}`} className="text-sm text-gray-500">
                {defaultModelId}
              </p>
            )}
          </div>

          {/* API key + test connection */}
          <div>
            <label
              htmlFor={`api-key-${useCase}`}
              className="block text-xs font-medium text-gray-500 mb-1"
            >
              API Key
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  id={`api-key-${useCase}`}
                  type={showKey ? 'text' : 'password'}
                  value={config.apiKey ?? ''}
                  onChange={(e) => handleKeyChange(e.target.value)}
                  placeholder="Enter your API key to select a custom model"
                  className="input pr-8"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.11 6.11m3.768 3.768a3 3 0 00-.208.33M21 21l-4.35-4.35m0 0A9.956 9.956 0 0012 19c-4.478 0-8.268-2.943-9.542-7a9.969 9.969 0 012.282-3.529" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={!hasKey || testStatus === 'testing'}
                className="btn-secondary shrink-0"
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test'}
              </button>
              {hasKey && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="btn-ghost shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Test result */}
            {testStatus === 'success' && (
              <span className="mt-1 flex items-center gap-1 text-xs text-green-600">
                <CheckIcon className="h-3.5 w-3.5" />
                Connected
              </span>
            )}
            {testStatus === 'error' && testError && (
              <p className="mt-1 text-xs text-red-500">{testError}</p>
            )}
          </div>

          {/* Info text — below key input */}
          <p className="text-xs text-gray-400">
            Your API key is stored only in this browser's local storage. It is forwarded through our backend to the LLM provider on each request, but is never persisted, logged, or stored on our servers.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function SettingsAI(): ReactNode {
  usePageTitle('Settings - AI Configuration')
  const { isAuthenticated, userId } = useAuthStatus()

  const { available, remainingPerDay, limitPerDay, resetsAt, isLoading: healthLoading } = useAIAvailability()

  // Find any configured BYOK key for the BYOK quota check
  const useCaseConfigs = useAIStore((s) => s.useCaseConfigs)
  const anyByokKey = useMemo(() => {
    for (const config of Object.values(useCaseConfigs)) {
      if (config.apiKey) return config.apiKey
    }
    return null
  }, [useCaseConfigs])

  // BYOK quota (with a BYOK header) — only fetched when a key exists
  const { data: byokHealth } = useQuery({
    queryKey: [...aiHealthKeys.all, 'byok', userId],
    queryFn: () => fetchAIHealth(anyByokKey!),
    enabled: isAuthenticated && !!userId && !!anyByokKey,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const { data: modelsData, isLoading: modelsLoading, error: modelsError } = useQuery<AIModelsResponse>({
    queryKey: ['ai-models'],
    queryFn: fetchAIModels,
    enabled: available,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  return (
    <div className="max-w-3xl pt-3">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">AI Configuration</h1>
        <p className="mt-1 text-sm text-gray-500">
          AI-powered features that help you organize and discover content.{' '}
          <Link to="/docs/features/ai" className="text-blue-600 hover:underline">Learn more</Link>
        </p>
      </div>

      {/* Tier gate — show upgrade prompt only after health check resolves */}
      {!healthLoading && !available && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            AI features are available on the Pro plan.{' '}
            <Link to="/pricing" className="font-medium underline hover:text-yellow-900">View pricing</Link>
          </p>
        </div>
      )}

      {/* Quota display — uses hook data for platform, separate query for BYOK */}
      {available && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>
              AI calls remaining: <span className="font-medium text-gray-900">{remainingPerDay.toLocaleString()}</span> / {limitPerDay.toLocaleString()} {resetsAt
                ? <>(resets at <span className="font-medium text-gray-900" title={resetsAt.toISOString()}>{resetsAt.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>)</>
                : '(24-hour window)'
              }
            </span>
            {anyByokKey && byokHealth && (
              <span>
                Your key: <span className="font-medium text-gray-900">{byokHealth.remaining_per_day.toLocaleString()}</span> / {byokHealth.limit_per_day.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Feature descriptions — visible to all tiers */}
      <div className="mb-8 space-y-4">
        <h2 className="text-base font-semibold text-gray-900">Features</h2>
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2 px-4 font-medium text-gray-900">Feature</th>
                <th className="text-left py-2 px-4 font-medium text-gray-900">Description</th>
                <th className="text-left py-2 px-4 font-medium text-gray-900">Where</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {AI_FEATURES.map((feature) => (
                <tr key={feature.name}>
                  <td className="py-2 px-4 font-medium text-gray-900 whitespace-nowrap">{feature.name}</td>
                  <td className="py-2 px-4 text-gray-600">{feature.description}</td>
                  <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{feature.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Configuration sections — only for AI-enabled tiers */}
      {available && (
        <>
          {/* Use case configuration rows */}
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Configuration</h2>
              <p className="mt-1 text-sm text-gray-500">
                Click on a use case below to configure its API key and model.
                When using your own key, API calls are billed directly by your provider.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              {modelsLoading ? (
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
                </div>
              ) : modelsError ? (
                <div className="p-4 text-sm text-red-600">
                  Failed to load models. Please refresh the page to try again.
                </div>
              ) : (
                ALL_USE_CASES.map((useCase) => (
                  <UseCaseRow
                    key={useCase}
                    useCase={useCase}
                    modelsData={modelsData}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
