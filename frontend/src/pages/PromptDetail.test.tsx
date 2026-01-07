/**
 * Tests for PromptDetail page.
 *
 * Tests view, edit, and create modes for prompts.
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

// Helper to render PromptDetail with router
function renderWithRouter(initialRoute: string): void {
  render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/app/prompts/new" element={<PromptDetail />} />
        <Route path="/app/prompts/:id" element={<PromptDetail />} />
        <Route path="/app/prompts/:id/edit" element={<PromptDetail />} />
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
        // Create mode shows the PromptEditor with Create Prompt button
        expect(screen.getByText('Create')).toBeInTheDocument()
      })
    })

    it('should not fetch prompt in create mode', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByText('Create')).toBeInTheDocument()
      })

      expect(mockFetchPrompt).not.toHaveBeenCalled()
    })

    it('should have cancel button in create mode', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        // Cancel button serves as "back" in edit/create mode
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })
    })

    it('should show name input field', async () => {
      renderWithRouter('/app/prompts/new')

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      })
    })
  })

  describe('view mode', () => {
    it('should fetch prompt by ID', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(mockFetchPrompt).toHaveBeenCalledWith('1')
      })
    })

    it('should track prompt usage in view mode', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(mockTrackPromptUsage).toHaveBeenCalledWith('1')
      })
    })

    it('should render prompt title', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('Code Review Template')).toBeInTheDocument()
      })
    })

    it('should render prompt name', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('code-review')).toBeInTheDocument()
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
        // Use title attribute to find tag buttons specifically
        expect(screen.getByTitle('Filter by tag: code')).toBeInTheDocument()
        expect(screen.getByTitle('Filter by tag: review')).toBeInTheDocument()
      })
    })

    it('should render prompt arguments', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('(required)')).toBeInTheDocument()
        expect(screen.getByText('— The code to review')).toBeInTheDocument()
      })
    })

    it('should show edit button in view mode', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
      })
    })

    it('should show archive button for active prompts', async () => {
      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument()
      })
    })
  })

  describe('edit mode', () => {
    it('should render edit form for /app/prompts/:id/edit', async () => {
      renderWithRouter('/app/prompts/1/edit')

      await waitFor(() => {
        // Edit mode shows the PromptEditor with Save Changes button
        expect(screen.getByText('Save')).toBeInTheDocument()
      })
    })

    it('should fetch prompt in edit mode', async () => {
      renderWithRouter('/app/prompts/1/edit')

      await waitFor(() => {
        expect(mockFetchPrompt).toHaveBeenCalledWith('1')
      })
    })

    it('should not track usage in edit mode', async () => {
      renderWithRouter('/app/prompts/1/edit')

      await waitFor(() => {
        expect(mockFetchPrompt).toHaveBeenCalled()
      })

      expect(mockTrackPromptUsage).not.toHaveBeenCalled()
    })

    it('should show save changes button', async () => {
      renderWithRouter('/app/prompts/1/edit')

      await waitFor(() => {
        expect(screen.getByText('Save')).toBeInTheDocument()
      })
    })

    it('should show cancel button', async () => {
      renderWithRouter('/app/prompts/1/edit')

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })
    })

    it('should populate form with existing prompt data', async () => {
      renderWithRouter('/app/prompts/1/edit')

      await waitFor(() => {
        expect(screen.getByDisplayValue('code-review')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Code Review Template')).toBeInTheDocument()
      })
    })
  })

  describe('archived prompt view', () => {
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
        expect(screen.getByText('Code Review Template')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument()
    })
  })

  describe('deleted prompt view', () => {
    it('should show restore button for deleted prompts', async () => {
      const deletedPrompt = { ...mockPrompt, deleted_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(deletedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument()
      })
    })

    it('should not show edit button for deleted prompts', async () => {
      const deletedPrompt = { ...mockPrompt, deleted_at: '2024-01-02T00:00:00Z' }
      mockFetchPrompt.mockResolvedValue(deletedPrompt)

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByText('Code Review Template')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
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
  })

  describe('loading state', () => {
    it('should show loading spinner while fetching prompt', async () => {
      mockFetchPrompt.mockImplementation(() => new Promise(() => {})) // Never resolves

      renderWithRouter('/app/prompts/1')

      expect(screen.getByText('Loading prompt...')).toBeInTheDocument()
    })
  })

  describe('navigation', () => {
    it('should navigate to list when close is clicked', async () => {
      const user = userEvent.setup()

      renderWithRouter('/app/prompts/1')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /close/i }))

      expect(mockNavigate).toHaveBeenCalledWith('/app/content')
    })
  })
})
