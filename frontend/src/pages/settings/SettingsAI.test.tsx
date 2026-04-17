/**
 * Tests for SettingsAI settings page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { SettingsAI } from './SettingsAI'
import { useAIStore } from '../../stores/aiStore'
import { createTestQueryClient } from '../../queryClient'
import type { AIModelsResponse, AIValidateKeyResponse, AIHealthResponse } from '../../types'

const mockFetchAIModels = vi.fn()
const mockValidateKey = vi.fn()
const mockFetchAIHealth = vi.fn()
vi.mock('../../services/aiApi', () => ({
  fetchAIModels: (...args: unknown[]) => mockFetchAIModels(...args),
  validateKey: (...args: unknown[]) => mockValidateKey(...args),
  fetchAIHealth: (...args: unknown[]) => mockFetchAIHealth(...args),
}))

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isLoading: false,
    userId: 'test-user-id',
  }),
}))

const MOCK_MODELS_RESPONSE: AIModelsResponse = {
  models: [
    { id: 'gemini/gemini-flash-lite-latest', provider: 'google', tier: 'budget' },
    { id: 'openai/gpt-5.4-nano', provider: 'openai', tier: 'budget' },
    { id: 'openai/gpt-5.4-mini', provider: 'openai', tier: 'balanced' },
    { id: 'anthropic/claude-haiku-4-5', provider: 'anthropic', tier: 'budget' },
    { id: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', tier: 'balanced' },
  ],
  defaults: {
    suggestions: 'gemini/gemini-flash-lite-latest',
    transform: 'gemini/gemini-flash-lite-latest',
    auto_complete: 'gemini/gemini-flash-lite-latest',
    chat: 'openai/gpt-5.4-mini',
  },
}

const MOCK_HEALTH_RESPONSE: AIHealthResponse = {
  available: true,
  byok: false,
  remaining_per_day: 25,
  limit_per_day: 30,
}

function renderPage(): ReturnType<typeof userEvent.setup> {
  const queryClient = createTestQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsAI />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function expandSuggestions(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  let button: HTMLElement
  await waitFor(() => {
    button = screen.getByRole('button', { name: /Suggestions configuration/ })
  })
  await user.click(button!)
}

describe('SettingsAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAIStore.getState().clearAllKeys()
    mockFetchAIModels.mockResolvedValue(MOCK_MODELS_RESPONSE)
    mockFetchAIHealth.mockResolvedValue(MOCK_HEALTH_RESPONSE)
  })

  describe('page rendering', () => {
    it('renders page heading', () => {
      renderPage()
      expect(screen.getByRole('heading', { name: 'AI Configuration', level: 1 })).toBeInTheDocument()
    })

    it('renders Configuration section with click instruction when AI available', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/Click on a use case below to configure/)).toBeInTheDocument()
      })
    })

    it('renders all four use case rows when AI available', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Suggestions configuration/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Transform configuration/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Auto-Complete configuration/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Chat configuration/ })).toBeInTheDocument()
      })
    })

    it('shows use case descriptions', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/Tags, metadata, and relationships/)).toBeInTheDocument()
        expect(screen.getByText(/Improve, summarize, and explain/)).toBeInTheDocument()
      })
    })

    it('shows billing note when AI available', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/API calls are billed directly by your provider/)).toBeInTheDocument()
      })
    })
  })

  describe('feature descriptions', () => {
    it('shows feature descriptions table for all tiers', () => {
      renderPage()
      expect(screen.getByRole('heading', { name: 'Features' })).toBeInTheDocument()
      expect(screen.getByText('Tag suggestions')).toBeInTheDocument()
      expect(screen.getByText('Metadata generation')).toBeInTheDocument()
      expect(screen.getByText('Relationship discovery')).toBeInTheDocument()
      expect(screen.getByText('Argument suggestions')).toBeInTheDocument()
    })

    it('shows feature table even when AI is not available', async () => {
      mockFetchAIHealth.mockResolvedValue({ ...MOCK_HEALTH_RESPONSE, available: false })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/AI features are available on the Pro plan/)).toBeInTheDocument()
      })
      expect(screen.getByText('Tag suggestions')).toBeInTheDocument()
    })
  })

  describe('tier gate', () => {
    it('shows upgrade prompt when AI is not available', async () => {
      mockFetchAIHealth.mockResolvedValue({ ...MOCK_HEALTH_RESPONSE, available: false })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/AI features are available on the Pro plan/)).toBeInTheDocument()
      })
    })

    it('does not show upgrade prompt while health is loading', () => {
      mockFetchAIHealth.mockReturnValue(new Promise(() => {})) // never resolves
      renderPage()
      expect(screen.queryByText(/AI features are available on the Pro plan/)).not.toBeInTheDocument()
    })

    it('hides configuration section when AI is not available', async () => {
      mockFetchAIHealth.mockResolvedValue({ ...MOCK_HEALTH_RESPONSE, available: false })
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/AI features are available on the Pro plan/)).toBeInTheDocument()
      })
      expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument()
    })

    it('shows configuration section when AI is available', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Configuration' })).toBeInTheDocument()
      })
    })
  })

  describe('inactive use cases', () => {
    it('shows Coming soon for Transform, Auto-Complete, Chat', async () => {
      renderPage()
      await waitFor(() => {
        const comingSoonElements = screen.getAllByText('Coming soon')
        expect(comingSoonElements).toHaveLength(3)
      })
    })

    it('inactive use cases are not expandable', async () => {
      const user = renderPage()
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Transform configuration/ })).toBeInTheDocument()
      })
      await user.click(screen.getByRole('button', { name: /Transform configuration/ }))
      expect(screen.queryByLabelText(/API Key/)).not.toBeInTheDocument()
    })
  })

  describe('expandable rows', () => {
    it('Suggestions row expands on click', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      expect(screen.getByLabelText(/API Key/)).toBeInTheDocument()
    })

    it('shows model as text when no key', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })

    it('shows model dropdown when key has value', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      const user = renderPage()
      await expandSuggestions(user)
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('shows info text inside expanded row', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      expect(screen.getByText(/stored only in this browser's local storage/)).toBeInTheDocument()
    })

    it('collapses on second click', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      expect(screen.getByLabelText(/API Key/)).toBeInTheDocument()

      await expandSuggestions(user)
      expect(screen.queryByLabelText(/API Key/)).not.toBeInTheDocument()
    })
  })

  describe('collapsed row subtitle', () => {
    it('shows description and model ID in subtitle for active use cases', async () => {
      renderPage()
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /Suggestions configuration/ })
        expect(button.textContent).toContain('Tags, metadata, and relationships')
        expect(button.textContent).toContain('gemini/gemini-flash-lite-latest')
      })
    })

    it('shows override model ID when BYOK model is set', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/anthropic\/claude-sonnet-4-6/)).toBeInTheDocument()
      })
    })
  })

  describe('per-use-case API key', () => {
    it('persists key to store on every change', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      await user.type(screen.getByLabelText(/API Key/), 'sk-test-key')

      expect(useAIStore.getState().useCaseConfigs.suggestions.apiKey).toBe('sk-test-key')
      expect(useAIStore.getState().useCaseConfigs.chat.apiKey).toBeNull()
    })

    it('toggles password visibility', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      const input = screen.getByLabelText(/API Key/)
      expect(input).toHaveAttribute('type', 'password')

      await user.click(screen.getByLabelText('Show API key'))
      expect(input).toHaveAttribute('type', 'text')

      await user.click(screen.getByLabelText('Hide API key'))
      expect(input).toHaveAttribute('type', 'password')
    })

    it('Clear button clears key and model for that use case', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-existing')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      const user = renderPage()
      await expandSuggestions(user)

      await user.click(screen.getByRole('button', { name: 'Clear' }))

      const config = useAIStore.getState().useCaseConfigs.suggestions
      expect(config.apiKey).toBeNull()
      expect(config.model).toBeNull()
    })
  })

  describe('test connection', () => {
    it('shows success on valid key', async () => {
      mockValidateKey.mockResolvedValue({ valid: true } satisfies AIValidateKeyResponse)
      useAIStore.getState().setApiKey('suggestions', 'sk-valid')
      const user = renderPage()
      await expandSuggestions(user)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument()
      })
    })

    it('shows error on invalid key', async () => {
      mockValidateKey.mockResolvedValue({
        valid: false,
        error: 'Key rejected by provider',
      } satisfies AIValidateKeyResponse)
      useAIStore.getState().setApiKey('suggestions', 'sk-bad')
      const user = renderPage()
      await expandSuggestions(user)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() => {
        expect(screen.getByText('Key rejected by provider')).toBeInTheDocument()
      })
    })

    it('shows error on network failure', async () => {
      mockValidateKey.mockRejectedValue(new Error('Network error'))
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      const user = renderPage()
      await expandSuggestions(user)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() => {
        expect(screen.getByText('Connection failed. Check your key and try again.')).toBeInTheDocument()
      })
    })

    it('is disabled when no key is entered', async () => {
      const user = renderPage()
      await expandSuggestions(user)
      expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled()
    })

    it('calls validateKey with the use case', async () => {
      mockValidateKey.mockResolvedValue({ valid: true })
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      const user = renderPage()
      await expandSuggestions(user)

      await user.click(screen.getByRole('button', { name: 'Test' }))

      await waitFor(() => {
        expect(mockValidateKey).toHaveBeenCalledWith('suggestions')
      })
    })
  })

  describe('model selection', () => {
    it('shows model IDs in dropdown options', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      const user = renderPage()
      await expandSuggestions(user)

      await waitFor(() => {
        const select = screen.getByRole('combobox')
        const options = select.querySelectorAll('option')
        expect(options[0]).toHaveTextContent('gemini/gemini-flash-lite-latest')
        expect(options[1]).toHaveTextContent('openai/gpt-5.4-nano')
        expect(options[2]).toHaveTextContent('openai/gpt-5.4-mini')
      })
    })

    it('sets model override when selecting a non-default model', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      const user = renderPage()
      await expandSuggestions(user)

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
      await user.selectOptions(screen.getByRole('combobox'), 'anthropic/claude-sonnet-4-6')

      expect(useAIStore.getState().useCaseConfigs.suggestions.model).toBe('anthropic/claude-sonnet-4-6')
    })

    it('clears model override when selecting platform default', async () => {
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      useAIStore.getState().setModel('suggestions', 'anthropic/claude-sonnet-4-6')
      const user = renderPage()
      await expandSuggestions(user)

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
      await user.selectOptions(screen.getByRole('combobox'), 'gemini/gemini-flash-lite-latest')

      expect(useAIStore.getState().useCaseConfigs.suggestions.model).toBeNull()
    })
  })

  describe('models loading/error states', () => {
    it('shows loading spinner while fetching models', async () => {
      mockFetchAIModels.mockReturnValue(new Promise(() => {}))
      renderPage()
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin')
        expect(spinner).toBeInTheDocument()
      })
    })

    it('shows error when models fetch fails', async () => {
      mockFetchAIModels.mockRejectedValue(new Error('API error'))
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/Failed to load models/)).toBeInTheDocument()
      })
    })
  })

  describe('quota display', () => {
    it('shows quota when AI is available', async () => {
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/AI calls remaining \(24-hour window\):/)).toBeInTheDocument()
        expect(screen.getByText('25')).toBeInTheDocument()
      })
    })

    it('shows both included and BYOK quota when a key is configured', async () => {
      const byokHealth = { available: true, byok: true, remaining_per_day: 1900, limit_per_day: 2000 }
      mockFetchAIHealth
        .mockResolvedValueOnce(MOCK_HEALTH_RESPONSE) // useAIAvailability
        .mockResolvedValueOnce(byokHealth) // byok query
      useAIStore.getState().setApiKey('suggestions', 'sk-test')
      renderPage()
      await waitFor(() => {
        expect(screen.getByText(/AI calls remaining \(24-hour window\):/)).toBeInTheDocument()
        expect(screen.getByText(/Your key:/)).toBeInTheDocument()
      })
    })
  })
})
