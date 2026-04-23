/**
 * Tests for useAIStore — per-use-case API key and model configuration.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAIStore } from './aiStore'

function defaultConfigs(): Record<string, { apiKey: string | null; model: string | null }> {
  return {
    suggestions: { apiKey: null, model: null },
    transform: { apiKey: null, model: null },
    auto_complete: { apiKey: null, model: null },
    chat: { apiKey: null, model: null },
  }
}

describe('useAIStore', () => {
  beforeEach(() => {
    useAIStore.setState({ useCaseConfigs: defaultConfigs() as ReturnType<typeof useAIStore.getState>['useCaseConfigs'] })
  })

  describe('initial state', () => {
    it('all use cases have null apiKey and null model', () => {
      const { useCaseConfigs } = useAIStore.getState()
      for (const config of Object.values(useCaseConfigs)) {
        expect(config.apiKey).toBeNull()
        expect(config.model).toBeNull()
      }
    })
  })

  describe('setApiKey', () => {
    it('sets the API key for a specific use case', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test-123')
      expect(useAIStore.getState().useCaseConfigs.suggestions.apiKey).toBe('sk-test-123')
    })

    it('does not affect other use cases', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test-123')
      expect(useAIStore.getState().useCaseConfigs.transform.apiKey).toBeNull()
      expect(useAIStore.getState().useCaseConfigs.chat.apiKey).toBeNull()
    })

    it('preserves existing model override when setting key', () => {
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      const config = useAIStore.getState().useCaseConfigs.suggestions
      expect(config.apiKey).toBe('sk-test')
      expect(config.model).toBe('anthropic/claude-sonnet-4-6')
    })
  })

  describe('clearApiKey', () => {
    it('clears key and model for a specific use case', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      useAIStore.getState().clearApiKey('suggestions')

      const config = useAIStore.getState().useCaseConfigs.suggestions
      expect(config.apiKey).toBeNull()
      expect(config.model).toBeNull()
    })

    it('does not affect other use cases', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test-1')
      useAIStore.getState().setApiKey('chat', 'sk-test-2')
      useAIStore.getState().clearApiKey('suggestions')

      expect(useAIStore.getState().useCaseConfigs.suggestions.apiKey).toBeNull()
      expect(useAIStore.getState().useCaseConfigs.chat.apiKey).toBe('sk-test-2')
    })
  })

  describe('clearAllKeys', () => {
    it('resets all use cases to defaults', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-1')
      useAIStore.getState().setApiKey('chat', 'sk-2')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      useAIStore.getState().clearAllKeys()

      const { useCaseConfigs } = useAIStore.getState()
      for (const config of Object.values(useCaseConfigs)) {
        expect(config.apiKey).toBeNull()
        expect(config.model).toBeNull()
      }
    })
  })

  describe('setModel', () => {
    it('sets model override for a specific use case', () => {
      useAIStore.getState().setModel('suggestions', 'openai/gpt-4o')
      expect(useAIStore.getState().useCaseConfigs.suggestions.model).toBe('openai/gpt-4o')
    })

    it('does not affect other use cases', () => {
      useAIStore.getState().setModel('suggestions', 'openai/gpt-4o')
      expect(useAIStore.getState().useCaseConfigs.transform.model).toBeNull()
    })
  })

  describe('clearModel', () => {
    it('reverts to platform default for a specific use case', () => {
      useAIStore.getState().setModel('suggestions', 'openai/gpt-4o')
      useAIStore.getState().clearModel('suggestions')
      expect(useAIStore.getState().useCaseConfigs.suggestions.model).toBeNull()
    })

    it('preserves the API key when clearing model', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'openai/gpt-4o')
      useAIStore.getState().clearModel('suggestions')

      const config = useAIStore.getState().useCaseConfigs.suggestions
      expect(config.apiKey).toBe('sk-test')
      expect(config.model).toBeNull()
    })
  })

  describe('getConfig', () => {
    it('returns the config for a specific use case', () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'openai/gpt-4o')

      const config = useAIStore.getState().getConfig('suggestions')
      expect(config.apiKey).toBe('sk-test')
      expect(config.model).toBe('openai/gpt-4o')
    })

    it('returns defaults when use case has no configuration', () => {
      const config = useAIStore.getState().getConfig('transform')
      expect(config.apiKey).toBeNull()
      expect(config.model).toBeNull()
    })
  })
})
