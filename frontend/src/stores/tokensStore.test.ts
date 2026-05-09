/**
 * Direct unit tests for tokensStore actions.
 *
 * The ordering invariant in createToken (KAN-145) is verified here rather
 * than at the page level — it's a pure state transition and shouldn't
 * depend on modal markup, focus management, or button labels to test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTokensStore } from './tokensStore'

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()
const mockApiPatch = vi.fn()
const mockApiDelete = vi.fn()
vi.mock('../services/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  useTokensStore.setState({ tokens: [], isLoading: false, error: null })
})

describe('tokensStore.fetchTokens', () => {
  it('populates tokens and clears isLoading on success', async () => {
    mockApiGet.mockResolvedValueOnce({
      data: [
        {
          id: 't1',
          name: 'CLI',
          token_prefix: 'bm_xxx',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-05-01T00:00:00Z',
        },
      ],
    })

    await useTokensStore.getState().fetchTokens()

    const state = useTokensStore.getState()
    expect(state.tokens).toHaveLength(1)
    expect(state.tokens[0].name).toBe('CLI')
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('sets error and clears isLoading on failure', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('network down'))

    await useTokensStore.getState().fetchTokens()

    const state = useTokensStore.getState()
    expect(state.tokens).toEqual([])
    expect(state.isLoading).toBe(false)
    expect(state.error).toBe('network down')
  })
})

describe('tokensStore.createToken', () => {
  const newTokenResponse = {
    id: 'new-id',
    name: 'Brand New',
    token: 'bm_secret_plaintext',
    token_prefix: 'bm_brand_xxx',
    expires_at: null,
    created_at: '2026-05-09T00:00:00Z',
  }

  it('prepends the new token to the list (matches backend newest-first ordering — KAN-145)', async () => {
    useTokensStore.setState({
      tokens: [
        {
          id: 'old-1',
          name: 'Old A',
          token_prefix: 'bm_oldA_xxx',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 'old-2',
          name: 'Old B',
          token_prefix: 'bm_oldB_xxx',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-04-15T00:00:00Z',
        },
      ],
    })
    mockApiPost.mockResolvedValueOnce({ data: newTokenResponse })

    await useTokensStore.getState().createToken({ name: 'Brand New' })

    const names = useTokensStore.getState().tokens.map((t) => t.name)
    expect(names).toEqual(['Brand New', 'Old A', 'Old B'])
  })

  it('maps TokenCreateResponse → Token, dropping plaintext and defaulting last_used_at to null', async () => {
    mockApiPost.mockResolvedValueOnce({ data: newTokenResponse })

    await useTokensStore.getState().createToken({ name: 'Brand New' })

    const token = useTokensStore.getState().tokens[0]
    expect(token).toEqual({
      id: 'new-id',
      name: 'Brand New',
      token_prefix: 'bm_brand_xxx',
      last_used_at: null,
      expires_at: null,
      created_at: '2026-05-09T00:00:00Z',
    })
    expect(token).not.toHaveProperty('token')
  })

  it('returns the full response (with plaintext) so the caller can reveal it', async () => {
    mockApiPost.mockResolvedValueOnce({ data: newTokenResponse })

    const response = await useTokensStore.getState().createToken({ name: 'Brand New' })

    expect(response.token).toBe('bm_secret_plaintext')
  })

  it('propagates errors and does not modify the list on failure', async () => {
    useTokensStore.setState({
      tokens: [
        {
          id: 'old-1',
          name: 'Old A',
          token_prefix: 'bm_oldA_xxx',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-05-01T00:00:00Z',
        },
      ],
    })
    mockApiPost.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(
      useTokensStore.getState().createToken({ name: 'Brand New' }),
    ).rejects.toThrow('quota exceeded')

    const names = useTokensStore.getState().tokens.map((t) => t.name)
    expect(names).toEqual(['Old A'])
  })
})

describe('tokensStore.renameToken', () => {
  it('updates the name in place without reordering', async () => {
    useTokensStore.setState({
      tokens: [
        {
          id: 't1',
          name: 'Old Name',
          token_prefix: 'bm_xxx',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 't2',
          name: 'Other',
          token_prefix: 'bm_yyy',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-04-01T00:00:00Z',
        },
      ],
    })
    mockApiPatch.mockResolvedValueOnce({
      data: {
        id: 't1',
        name: 'New Name',
        token_prefix: 'bm_xxx',
        last_used_at: null,
        expires_at: null,
        created_at: '2026-05-01T00:00:00Z',
      },
    })

    await useTokensStore.getState().renameToken('t1', 'New Name')

    const tokens = useTokensStore.getState().tokens
    expect(tokens.map((t) => [t.id, t.name])).toEqual([
      ['t1', 'New Name'],
      ['t2', 'Other'],
    ])
  })
})

describe('tokensStore.deleteToken', () => {
  it('removes the token from the list', async () => {
    useTokensStore.setState({
      tokens: [
        {
          id: 't1',
          name: 'A',
          token_prefix: 'bm_a',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 't2',
          name: 'B',
          token_prefix: 'bm_b',
          last_used_at: null,
          expires_at: null,
          created_at: '2026-04-01T00:00:00Z',
        },
      ],
    })
    mockApiDelete.mockResolvedValueOnce({})

    await useTokensStore.getState().deleteToken('t1')

    const ids = useTokensStore.getState().tokens.map((t) => t.id)
    expect(ids).toEqual(['t2'])
  })
})
