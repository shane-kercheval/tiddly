/**
 * Integration smoke test for the SettingsTokens create flow.
 *
 * Verifies that opening the modal, submitting, and clicking Done leaves
 * the new token visible in the list. The ordering invariant (KAN-145)
 * is verified directly in stores/tokensStore.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsTokens } from './SettingsTokens'
import { useTokensStore } from '../../stores/tokensStore'

vi.mock('../../config', () => ({
  config: {
    apiUrl: 'http://localhost:8000',
  },
}))

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()
vi.mock('../../services/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}))

const mockWriteText = vi.fn().mockResolvedValue(undefined)

beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: mockWriteText,
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  useTokensStore.setState({ tokens: [], isLoading: false, error: null })
  mockApiGet.mockResolvedValue({ data: [] })
})

describe('SettingsTokens', () => {
  it('shows the new token in the list after the create-and-done flow', async () => {
    const user = userEvent.setup()
    mockApiPost.mockResolvedValueOnce({
      data: {
        id: 'new-token-id',
        name: 'My CLI Token',
        token: 'bm_secret_plaintext_value',
        token_prefix: 'bm_secret_p',
        expires_at: null,
        created_at: '2026-05-09T12:00:00Z',
      },
    })

    render(<SettingsTokens />)
    await screen.findByText(/no tokens created yet/i)

    await user.click(screen.getByRole('button', { name: /create token/i }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/token name/i), 'My CLI Token')
    await user.click(within(dialog).getByRole('button', { name: 'Create Token' }))

    await screen.findByText(/token created/i)
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => {
      expect(screen.getByText('My CLI Token')).toBeInTheDocument()
    })
  })
})
