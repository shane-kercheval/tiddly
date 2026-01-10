/**
 * Tests for PromptDetail page.
 *
 * Tests the unified Prompt component for creating and editing prompts.
 * The unified component is always editable - there's no separate view/edit mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PromptDetail } from './PromptDetail'
import type { Prompt } from '../types'

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock prompt data
const mockPrompt: Prompt = {
  id: '1',
  name: 'code-review',
  title: 'Code Review Template',
  description: 'A prompt for reviewing code',
  content: '# Review\n\nPlease review {{ code }}',
  arguments: [
    { name: 'code', description: 'The code to review', required: true },
  ],
  tags: ['code', 'review'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

// Mock hooks
const mockFetchPrompt = vi.fn()
const mockTrackPromptUsage = vi.fn()
const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()
const mockDeleteMutateAsync = vi.fn()
const mockArchiveMutateAsync = vi.fn()
const mockUnarchiveMutateAsync = vi.fn()
const mockRestoreMutateAsync = vi.fn()
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../hooks/usePrompts', () => ({
  usePrompts: () => ({
    fetchPrompt: mockFetchPrompt,
    trackPromptUsage: mockTrackPromptUsage,
  }),
}))

vi.mock('../hooks/usePromptMutations', () => ({
  useCreatePrompt: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUpdatePrompt: () => ({
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
  useDeletePrompt: () => ({
    mutateAsync: mockDeleteMutateAsync,
  }),
  useRestorePrompt: () => ({
    mutateAsync: mockRestoreMutateAsync,
  }),
  useArchivePrompt: () => ({
    mutateAsync: mockArchiveMutateAsync,
  }),
  useUnarchivePrompt: () => ({
    mutateAsync: mockUnarchiveMutateAsync,
  }),
}))

vi.mock('../stores/tagsStore', () => ({
  useTagsStore: () => ({
    tags: [{ name: 'code', count: 5 }, { name: 'review', count: 3 }],
  }),
}))

vi.mock('../stores/tagFilterStore', () => ({
  useTagFilterStore: Object.assign(
    () => ({
      selectedTags: [],
      addTag: vi.fn(),
    }),
    {
      getState: () => ({
        addTag: vi.fn(),
      }),
    }
  ),
}))

vi.mock('../stores/uiPreferencesStore', () => ({
  useUIPreferencesStore: (selector: (state: { fullWidthLayout: boolean }) => boolean) =>
    selector({ fullWidthLayout: false }),
}))

// Mock extractTemplateVariables to avoid validation failures from DEFAULT_PROMPT_CONTENT
// The default content has template variables like {{ code_snippet }} which would fail validation
vi.mock('../utils/extractTemplateVariables', () => ({
  extractTemplateVariables: () => ({ variables: new Set<string>(), error: undefined }),
}))

// Helper to render PromptDetail with router
function renderWithRouter(initialRoute: string): void {
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/app/prompts/new" element={<PromptDetail />} />
        <Route path="/app/prompts/:id" element={<PromptDetail />} />
        <Route path="/app/prompts" element={<div>Prompts List</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PromptDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchPrompt.mockResolvedValue(mockPrompt)
    // Clear any localStorage drafts
    localStorage.clear()
  })

  describe('create mode', () => {
    it('should render create form for /app/prompts/new', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        // Create mode shows the unified Prompt component with Close button
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('should not fetch prompt in create mode', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })

      expect(mockFetchPrompt).not.toHaveBeenCalled()
    })

    it('should have close button in create mode', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('should show name input field', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('prompt-name')).toBeInTheDocument()
      })
    })

    it('should show Create button when form is dirty and valid', async () => {
      const user = userEvent.setup()
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('prompt-name')).toBeInTheDocument()
      })

      // Type in name to make form dirty (need valid name format)
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-new-prompt')

      await waitFor(() => {
        expect(screen.getByText('Create')).toBeInTheDocument()
      })
    })

    it('should show Discard? confirmation when Close is clicked with dirty form', async () => {
      const user = userEvent.setup()
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('prompt-name')).toBeInTheDocument()
      })

      // Type in name to make form dirty
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-new-prompt')

      // Click Close to trigger confirmation
      await user.click(screen.getByText('Close'))

      await waitFor(() => {
        expect(screen.getByText('Discard?')).toBeInTheDocument()
      })
    })
  })

  describe('existing prompt', () => {
    it('should fetch prompt by ID', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(mockFetchPrompt).toHaveBeenCalledWith('1')
      })
    })

    it('should track prompt usage', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(mockTrackPromptUsage).toHaveBeenCalledWith('1')
      })
    })

    it('should render prompt name in editable field', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByDisplayValue('code-review')).toBeInTheDocument()
      })
    })

    it('should render prompt title in editable field', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Code Review Template')).toBeInTheDocument()
      })
    })

    it('should render prompt description', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('A prompt for reviewing code')).toBeInTheDocument()
      })
    })

    it('should render prompt tags', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('code')).toBeInTheDocument()
        expect(screen.getByText('review')).toBeInTheDocument()
      })
    })

    it('should show Close button', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })
    })

    it('should show archive button for active prompts', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('Archive')).toBeInTheDocument()
      })
    })

    it('should show Save button when form is dirty', async () => {
      const user = userEvent.setup()
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByDisplayValue('code-review')).toBeInTheDocument()
      })

      // Modify name to make form dirty
      await user.clear(screen.getByDisplayValue('code-review'))
      await user.type(screen.getByPlaceholderText('prompt-name'), 'updated-name')

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument()
      })
    })
  })

  describe('archived prompt', () => {
    it('should show restore button for archived prompts', async () => {
      const archivedPrompt = { ...mockPrompt, archived_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(archivedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
      })
    })

    it('should not show archive button for archived prompts', async () => {
      const archivedPrompt = { ...mockPrompt, archived_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(archivedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByDisplayValue('Code Review Template')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument()
    })
  })

  describe('deleted prompt', () => {
    it('should show restore button for deleted prompts', async () => {
      const deletedPrompt = { ...mockPrompt, deleted_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(deletedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
      })
    })

    it('should show read-only banner for deleted prompts', async () => {
      const deletedPrompt = { ...mockPrompt, deleted_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(deletedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText(/in trash and cannot be edited/i)).toBeInTheDocument()
      })
    })

    it('should show delete permanently button for deleted prompts', async () => {
      const deletedPrompt = { ...mockPrompt, deleted_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(deletedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument()
      })
    })
  })

  describe('error handling', () => {
    it('should show error state when prompt fetch fails', async () => {
      mockFetchPrompt.mockRejectedValue(new Error('Network error'))

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument()
      })
    })

    it('should show error when API returns not found', async () => {
      mockFetchPrompt.mockRejectedValue(new Error('Prompt not found'))
      renderWithRouter('/app/prompts/invalid-uuid')

      await waitFor(() => {
        expect(screen.getByText('Prompt not found')).toBeInTheDocument()
      })
    })

    it('should show validation error on name field when 409 NAME_CONFLICT is returned', async () => {
      const user = userEvent.setup()
      const conflictError = {
        response: {
          status: 409,
          data: {
            detail: {
              message: "A prompt with name 'my-prompt' already exists",
              error_code: 'NAME_CONFLICT',
            },
          },
        },
      }
      mockCreateMutateAsync.mockRejectedValue(conflictError)

      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('prompt-name')).toBeInTheDocument()
      })

      // Fill in the form
      await user.type(screen.getByPlaceholderText('prompt-name'), 'my-prompt')

      // Click Create
      await user.click(screen.getByText('Create'))

      // Should show validation error on name field
      await waitFor(() => {
        expect(screen.getByText("A prompt with name 'my-prompt' already exists")).toBeInTheDocument()
      })
    })
  })

  describe('loading state', () => {
    it('should show loading spinner while fetching prompt', async () => {
      mockFetchPrompt.mockImplementation(() => new Promise(() => {})) // Never resolves

      renderWithRouter('/app/prompts/1')

      expect(screen.getByText('Loading prompt...')).toBeInTheDocument()
    })
  })

  describe('navigation', () => {
    it('should navigate to list when Close is clicked', async () => {
      const user = userEvent.setup()

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('Close')).toBeInTheDocument()
      })

      await user.click(screen.getByText('Close'))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
    })
  })

  describe('create then stay on page', () => {
    it('should navigate to prompt URL with state after creating', async () => {
      const user = userEvent.setup()
      const createdPrompt = { ...mockPrompt, id: 'new-prompt-id', name: 'new-prompt' }
      mockCreateMutateAsync.mockResolvedValue(createdPrompt)

      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByPlaceholderText('prompt-name')).toBeInTheDocument()
      })

      // Fill in required fields (name and content)
      await user.type(screen.getByPlaceholderText('prompt-name'), 'new-prompt')

      // Wait for Create button to be enabled (form is dirty and valid)
      const createButton = await waitFor(() => {
        const button = screen.getByText('Create').closest('button')
        expect(button).not.toBeDisabled()
        return button!
      })

      // Submit the form by clicking the button
      await user.click(createButton)

      // Wait for mutation to be called and navigate to happen
      await waitFor(() => {
        expect(mockCreateMutateAsync).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/app/prompts/new-prompt-id',
          {
            replace: true,
            state: { prompt: createdPrompt },
          }
        )
      })
    })

    it('should use prompt from location state instead of fetching', async () => {
      const passedPrompt = { ...mockPrompt, id: '123', name: 'passed-prompt' }

      render(
        <MemoryRouter
          initialEntries={[{ pathname: '/app/prompts/123', state: { prompt: passedPrompt } }]}
        >
          <Routes>
            <Route path="/app/prompts/:id" element={<PromptDetail />} />
          </Routes>
        </MemoryRouter>
      )

      // Should display the passed prompt without fetching
      await waitFor(() => {
        expect(screen.getByDisplayValue('passed-prompt')).toBeInTheDocument()
      })

      // Should NOT have called fetchPrompt since we passed the prompt
      expect(mockFetchPrompt).not.toHaveBeenCalled()

      // Should still track usage
      expect(mockTrackPromptUsage).toHaveBeenCalledWith('123')
    })

    it('should fetch prompt if passed prompt ID does not match route ID', async () => {
      const passedPrompt = { ...mockPrompt, id: 'different-id', name: 'wrong-prompt' }

      render(
        <MemoryRouter
          initialEntries={[{ pathname: '/app/prompts/123', state: { prompt: passedPrompt } }]}
        >
          <Routes>
            <Route path="/app/prompts/:id" element={<PromptDetail />} />
          </Routes>
        </MemoryRouter>
      )

      // Should fetch since IDs don't match
      await waitFor(() => {
        expect(mockFetchPrompt).toHaveBeenCalledWith('123')
      })
    })
  })
})
