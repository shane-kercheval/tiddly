/**
 * AI API methods.
 *
 * All AI calls flow through this module. Each method reads the per-use-case
 * config (API key + model) from the store and sets headers/body accordingly.
 * Each suggestion method invalidates the /ai/health cache after a successful
 * call so quota display stays current.
 */
import { api } from './api'
import { useAIStore } from '../stores/aiStore'
import type { AIUseCase } from '../stores/aiStore'
import { queryClient } from '../queryClient'
import { aiHealthKeys } from '../hooks/useAIAvailability'
import type {
  AIHealthResponse,
  AIModelsResponse,
  AIValidateKeyResponse,
  SuggestTagsRequest,
  SuggestTagsResponse,
  SuggestMetadataRequest,
  SuggestMetadataResponse,
  SuggestRelationshipsRequest,
  SuggestRelationshipsResponse,
  SuggestPromptArgumentsRequest,
  SuggestPromptArgumentFieldsRequest,
  SuggestPromptArgumentsResponse,
} from '../types'

// ---------------------------------------------------------------------------
// Per-use-case request config helper
// ---------------------------------------------------------------------------

/**
 * Read the API key and model for a use case from the store.
 * Returns headers (with X-LLM-Api-Key if key is set) and model override.
 */
export function aiRequestConfig(useCase: AIUseCase): {
  model: string | null
  headers: Record<string, string>
} {
  const config = useAIStore.getState().getConfig(useCase)
  return {
    model: config.model,
    headers: config.apiKey ? { 'X-LLM-Api-Key': config.apiKey } : {},
  }
}

// ---------------------------------------------------------------------------
// Invalidation helper
// ---------------------------------------------------------------------------

function invalidateHealthCache(): void {
  queryClient.invalidateQueries({ queryKey: aiHealthKeys.all })
}

// ---------------------------------------------------------------------------
// Config endpoints (no AI rate limit consumed)
// ---------------------------------------------------------------------------

/**
 * Fetch AI health/quota status.
 * Pass an API key to check BYOK quota; omit for platform quota.
 */
export async function fetchAIHealth(apiKey?: string): Promise<AIHealthResponse> {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['X-LLM-Api-Key'] = apiKey
  }
  const response = await api.get<AIHealthResponse>('/ai/health', { headers })
  return response.data
}

export async function fetchAIModels(): Promise<AIModelsResponse> {
  const response = await api.get<AIModelsResponse>('/ai/models')
  return response.data
}

/**
 * Validate a BYOK API key by making a minimal provider call.
 * Sends both the key (via header) and the selected model (via body)
 * so the backend tests the key against the correct provider.
 */
export async function validateKey(useCase: AIUseCase): Promise<AIValidateKeyResponse> {
  const { model, headers } = aiRequestConfig(useCase)
  const response = await api.post<AIValidateKeyResponse>(
    '/ai/validate-key',
    { model },
    { headers },
  )
  // validate-key consumes BYOK quota, so invalidate health cache
  invalidateHealthCache()
  return response.data
}

// ---------------------------------------------------------------------------
// Suggestion endpoints (consume AI rate limit)
// ---------------------------------------------------------------------------

export async function suggestTags(data: SuggestTagsRequest): Promise<SuggestTagsResponse> {
  const { model, headers } = aiRequestConfig('suggestions')
  const response = await api.post<SuggestTagsResponse>(
    '/ai/suggest-tags',
    { ...data, model },
    { headers },
  )
  invalidateHealthCache()
  return response.data
}

export async function suggestMetadata(data: SuggestMetadataRequest): Promise<SuggestMetadataResponse> {
  const { model, headers } = aiRequestConfig('suggestions')
  const response = await api.post<SuggestMetadataResponse>(
    '/ai/suggest-metadata',
    { ...data, model },
    { headers },
  )
  invalidateHealthCache()
  return response.data
}

export async function suggestRelationships(data: SuggestRelationshipsRequest): Promise<SuggestRelationshipsResponse> {
  const { model, headers } = aiRequestConfig('suggestions')
  const response = await api.post<SuggestRelationshipsResponse>(
    '/ai/suggest-relationships',
    { ...data, model },
    { headers },
  )
  invalidateHealthCache()
  return response.data
}

export async function suggestPromptArguments(
  data: SuggestPromptArgumentsRequest,
): Promise<SuggestPromptArgumentsResponse> {
  const { model, headers } = aiRequestConfig('suggestions')
  const response = await api.post<SuggestPromptArgumentsResponse>(
    '/ai/suggest-prompt-arguments',
    { ...data, model },
    { headers },
  )
  invalidateHealthCache()
  return response.data
}

export async function suggestPromptArgumentFields(
  data: SuggestPromptArgumentFieldsRequest,
): Promise<SuggestPromptArgumentsResponse> {
  const { model, headers } = aiRequestConfig('suggestions')
  const response = await api.post<SuggestPromptArgumentsResponse>(
    '/ai/suggest-prompt-argument-fields',
    { ...data, model },
    { headers },
  )
  invalidateHealthCache()
  return response.data
}
