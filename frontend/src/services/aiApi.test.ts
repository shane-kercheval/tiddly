/**
 * Tests for AI API layer.
 *
 * Covers:
 * - aiRequestConfig helper reads correct per-use-case config
 * - Model override and key header sent correctly per use case
 * - Health cache invalidation after suggestion calls and validate-key
 * - validateKey sends both key header and model in body
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAIStore } from '../stores/aiStore'

const { mockPost, mockGet, mockInvalidateQueries } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet: vi.fn(),
  mockInvalidateQueries: vi.fn(),
}))

vi.mock('./api', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}))

vi.mock('../queryClient', () => ({
  queryClient: {
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  },
}))

import {
  aiRequestConfig,
  validateKey,
  suggestTags,
  suggestMetadata,
  suggestRelationships,
  suggestArguments,
  fetchAIHealth,
  fetchAIModels,
} from './aiApi'

describe('aiApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAIStore.getState().clearAllKeys()
  })

  describe('aiRequestConfig', () => {
    it('returns empty headers and null model when no key is configured', () => {
      const result = aiRequestConfig('suggestions')
      expect(result.headers).toEqual({})
      expect(result.model).toBeNull()
    })

    it('returns X-LLM-Api-Key header when key is configured', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test-123')
      const result = aiRequestConfig('suggestions')
      expect(result.headers).toEqual({ 'X-LLM-Api-Key': 'sk-test-123' })
    })

    it('returns model override when set', () => {
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      const result = aiRequestConfig('suggestions')
      expect(result.model).toBe('anthropic/claude-sonnet-4-6')
    })

    it('reads the correct use case config, not another', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-suggestions')
      useAIStore.getState().setApiKey('chat', 'sk-chat')

      const suggestionsResult = aiRequestConfig('suggestions')
      const chatResult = aiRequestConfig('chat')
      const transformResult = aiRequestConfig('transform')

      expect(suggestionsResult.headers).toEqual({ 'X-LLM-Api-Key': 'sk-suggestions' })
      expect(chatResult.headers).toEqual({ 'X-LLM-Api-Key': 'sk-chat' })
      expect(transformResult.headers).toEqual({})
    })
  })

  describe('config endpoints', () => {
    it('fetchAIHealth calls GET /ai/health without BYOK header', async () => {
      mockGet.mockResolvedValue({ data: { available: true } })
      const result = await fetchAIHealth()
      expect(mockGet).toHaveBeenCalledWith('/ai/health', { headers: {} })
      expect(result).toEqual({ available: true })
    })

    it('fetchAIHealth sends BYOK header when API key provided', async () => {
      mockGet.mockResolvedValue({ data: { available: true, byok: true } })
      const result = await fetchAIHealth('sk-test-key')
      expect(mockGet).toHaveBeenCalledWith('/ai/health', {
        headers: { 'X-LLM-Api-Key': 'sk-test-key' },
      })
      expect(result).toEqual({ available: true, byok: true })
    })

    it('fetchAIModels calls GET /ai/models', async () => {
      mockGet.mockResolvedValue({ data: { models: [], defaults: {} } })
      const result = await fetchAIModels()
      expect(mockGet).toHaveBeenCalledWith('/ai/models')
      expect(result).toEqual({ models: [], defaults: {} })
    })
  })

  describe('validateKey', () => {
    it('sends key header and model in body for the specified use case', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      mockPost.mockResolvedValue({ data: { valid: true } })

      await validateKey('suggestions')

      expect(mockPost).toHaveBeenCalledWith(
        '/ai/validate-key',
        { model: 'anthropic/claude-sonnet-4-6' },
        { headers: { 'X-LLM-Api-Key': 'sk-test' } },
      )
    })

    it('sends no header when no key is configured', async () => {
      mockPost.mockResolvedValue({ data: { valid: true } })
      await validateKey('suggestions')

      expect(mockPost).toHaveBeenCalledWith(
        '/ai/validate-key',
        { model: null },
        { headers: {} },
      )
    })

    it('invalidates health cache after call', async () => {
      mockPost.mockResolvedValue({ data: { valid: true } })
      await validateKey('suggestions')
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['ai-health'] })
    })
  })

  describe('suggestion endpoints', () => {
    it('suggestTags sends model + headers from config and invalidates health', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      mockPost.mockResolvedValue({ data: { tags: ['test'] } })

      const result = await suggestTags({ title: 'Test', content_type: 'bookmark' })

      expect(mockPost).toHaveBeenCalledWith(
        '/ai/suggest-tags',
        { title: 'Test', content_type: 'bookmark', model: 'anthropic/claude-sonnet-4-6' },
        { headers: { 'X-LLM-Api-Key': 'sk-test' } },
      )
      expect(result).toEqual({ tags: ['test'] })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['ai-health'] })
    })

    it('suggestTags sends null model and no header when unconfigured', async () => {
      mockPost.mockResolvedValue({ data: { tags: [] } })
      await suggestTags({ title: 'Test', content_type: 'bookmark' })

      expect(mockPost).toHaveBeenCalledWith(
        '/ai/suggest-tags',
        { title: 'Test', content_type: 'bookmark', model: null },
        { headers: {} },
      )
    })

    it('suggestMetadata passes config and invalidates health', async () => {
      mockPost.mockResolvedValue({ data: { title: 'Suggested', description: null } })
      await suggestMetadata({ fields: ['title'], url: 'https://example.com' })

      expect(mockPost).toHaveBeenCalledWith(
        '/ai/suggest-metadata',
        { fields: ['title'], url: 'https://example.com', model: null },
        { headers: {} },
      )
      expect(mockInvalidateQueries).toHaveBeenCalled()
    })

    it('suggestRelationships invalidates health cache', async () => {
      mockPost.mockResolvedValue({ data: { candidates: [] } })
      await suggestRelationships({ title: 'Test' })
      expect(mockInvalidateQueries).toHaveBeenCalled()
    })

    it('suggestArguments invalidates health cache', async () => {
      mockPost.mockResolvedValue({ data: { arguments: [] } })
      await suggestArguments({ prompt_content: 'Hello {{ name }}' })
      expect(mockInvalidateQueries).toHaveBeenCalled()
    })
  })
})
