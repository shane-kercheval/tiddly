/**
 * Tests for PromptEditor component.
 *
 * Tests validation logic, draft handling, and form submission.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptEditor } from './PromptEditor'
import type { Prompt, TagCount } from '../types'

// Mock TagInput to simplify testing
vi.mock('./TagInput', () => ({
  TagInput: vi.fn(({ value, onChange, placeholder, disabled, id }) => (
    <input
      id={id}
      data-testid="tag-input"
      value={value.join(', ')}
      onChange={(e) => onChange(e.target.value.split(', ').filter(Boolean))}
      placeholder={placeholder}
      disabled={disabled}
    />
  )),
}))

// Mock MarkdownEditor to simplify testing (CodeMirror uses contenteditable)
vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: vi.fn(({ value, onChange, disabled, label, maxLength, errorMessage }) => (
    <div>
      <label htmlFor="content">{label}</label>
      <textarea
        id="content"
        data-testid="markdown-editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <span>{value.length.toLocaleString()}/{maxLength?.toLocaleString()}</span>
      {errorMessage && <p className="error-text">{errorMessage}</p>}
    </div>
  )),
}))

const mockTagSuggestions: TagCount[] = [
  { name: 'test', count: 5 },
  { name: 'example', count: 3 },
]

const mockPrompt: Prompt = {
  id: 1,
  name: 'test-prompt',
  title: 'Test Prompt',
  description: 'A test description',
  content: 'Hello {{ name }}',
  arguments: [{ name: 'name', description: 'Your name', required: true }],
  tags: ['test'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_used_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
  archived_at: null,
}

describe('PromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('name validation', () => {
    it('should show error when name is empty on submit', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Clear the name field and try to submit
      const nameInput = screen.getByLabelText(/name/i)
      await user.clear(nameInput)

      // Submit button should be disabled when name is empty
      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      expect(submitButton).toBeDisabled()
    })

    it('should show error for invalid name pattern', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'Invalid Name!')

      // Try to submit
      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      // Should show validation error
      expect(screen.getByText(/must use lowercase letters, numbers, and hyphens only/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should accept valid name pattern (lowercase with hyphens)', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'valid-prompt-name')

      // Set simple content (content is required, clear default template variables)
      const contentEditor = screen.getByTestId('markdown-editor')
      await user.clear(contentEditor)
      await user.type(contentEditor, 'Test content')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })

    it('should auto-lowercase name input', async () => {
      const user = userEvent.setup()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'UPPERCASE')

      expect(nameInput).toHaveValue('uppercase')
    })

    it('should accept name starting with number', async () => {
      // The backend pattern ^[a-z0-9]+(-[a-z0-9]+)*$ allows starting with a number
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, '123-prompt')

      // Set simple content (content is required, clear default template variables)
      const contentEditor = screen.getByTestId('markdown-editor')
      await user.clear(contentEditor)
      await user.type(contentEditor, 'Test content')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })

    it('should reject name with trailing hyphen', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'code-review-')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      // The error text contains the full validation message
      const errorElement = screen.getByText(/Name must use lowercase letters/i)
      expect(errorElement).toHaveClass('error-text')
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should reject name with leading hyphen', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, '-code-review')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/must use lowercase letters, numbers, and hyphens only/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should reject name with consecutive hyphens', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'code--review')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/must use lowercase letters, numbers, and hyphens only/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should have maxLength attribute set to 255 for name input', () => {
      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      expect(nameInput).toHaveAttribute('maxLength', '255')
    })

    it('should truncate name input to max length (255)', async () => {
      const user = userEvent.setup()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      const nameInput = screen.getByLabelText(/name/i)
      // Try to type more than 255 characters - browser will truncate
      const longName = 'a'.repeat(300)
      await user.type(nameInput, longName)

      // Should be truncated to 255
      expect(nameInput).toHaveValue('a'.repeat(255))
    })
  })

  describe('argument validation', () => {
    it('should show error for empty argument name', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Add a valid name first
      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'test-prompt')

      // Add an argument
      const addArgButton = screen.getByRole('button', { name: /add argument/i })
      await user.click(addArgButton)

      // Don't fill in the argument name - try to submit
      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/argument 1 name is required/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should show error for invalid argument name pattern', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Add a valid prompt name
      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'test-prompt')

      // Add an argument
      const addArgButton = screen.getByRole('button', { name: /add argument/i })
      await user.click(addArgButton)

      // Fill in invalid argument name (with hyphens instead of underscores)
      const argInput = screen.getByPlaceholderText('argument_name')
      await user.type(argInput, 'invalid-name')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/must start with a letter and contain only lowercase letters, numbers, and underscores/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should show error for duplicate argument names', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Add a valid prompt name
      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'test-prompt')

      // Add two arguments
      const addArgButton = screen.getByRole('button', { name: /add argument/i })
      await user.click(addArgButton)
      await user.click(addArgButton)

      // Fill in the same name for both
      const argInputs = screen.getAllByPlaceholderText('argument_name')
      await user.type(argInputs[0], 'duplicate_name')
      await user.type(argInputs[1], 'duplicate_name')

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/duplicate argument name: duplicate_name/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should accept valid argument name pattern (lowercase with underscores)', async () => {
      // Test that argument names with underscores are valid
      // We use an existing prompt to avoid complexity with template validation
      const promptWithUnderscoreArg: Prompt = {
        ...mockPrompt,
        content: 'Hello {{ user_name }}',
        arguments: [{ name: 'user_name', description: 'Name with underscore', required: true }],
      }
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      render(
        <PromptEditor
          prompt={promptWithUnderscoreArg}
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Verify argument with underscore is shown
      expect(screen.getByDisplayValue('user_name')).toBeInTheDocument()

      // Submit the form
      const submitButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })
    })

    it('should reject argument name exceeding max length (100)', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Add a valid prompt name
      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'test-prompt')

      // Add an argument
      const addArgButton = screen.getByRole('button', { name: /add argument/i })
      await user.click(addArgButton)

      // Fill in argument name exceeding 100 characters
      const argInput = screen.getByPlaceholderText('argument_name')
      const longArgName = 'a'.repeat(101)
      await user.type(argInput, longArgName)

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/exceeds 100 characters/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })

  describe('argument management', () => {
    it('should add and remove arguments', async () => {
      const user = userEvent.setup()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      // Initially no arguments
      expect(screen.getByText(/no arguments defined/i)).toBeInTheDocument()

      // Add an argument
      const addArgButton = screen.getByRole('button', { name: /add argument/i })
      await user.click(addArgButton)

      // Should have argument input now
      expect(screen.getByPlaceholderText('argument_name')).toBeInTheDocument()
      expect(screen.queryByText(/no arguments defined/i)).not.toBeInTheDocument()

      // Remove the argument
      const removeButton = screen.getByTitle('Remove argument')
      await user.click(removeButton)

      // Back to no arguments
      expect(screen.getByText(/no arguments defined/i)).toBeInTheDocument()
    })

    it('should toggle required checkbox', async () => {
      const user = userEvent.setup()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      // Add an argument
      const addArgButton = screen.getByRole('button', { name: /add argument/i })
      await user.click(addArgButton)

      const requiredCheckbox = screen.getByLabelText(/required/i)
      expect(requiredCheckbox).not.toBeChecked()

      await user.click(requiredCheckbox)
      expect(requiredCheckbox).toBeChecked()
    })
  })

  describe('content validation', () => {
    it('should reject content exceeding max length (100,000)', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Add a valid prompt name
      const nameInput = screen.getByLabelText(/name/i)
      await user.type(nameInput, 'test-prompt')

      // Clear default content first, then add content exceeding 100,000 characters
      const contentTextarea = screen.getByTestId('markdown-editor')
      await user.clear(contentTextarea)
      const longContent = 'a'.repeat(100001)
      // Use paste to avoid typing 100k+ characters
      await user.click(contentTextarea)
      await user.paste(longContent)

      const submitButton = screen.getByRole('button', { name: /create prompt/i })
      await user.click(submitButton)

      expect(screen.getByText(/content exceeds 100,000 characters/i)).toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('should show character count for content field', () => {
      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      // Should show character count (new prompts have default content)
      expect(screen.getByText(/\/100,000/)).toBeInTheDocument()
    })

    it('should update character count as content changes', async () => {
      const user = userEvent.setup()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      const contentTextarea = screen.getByLabelText(/template content/i)
      // Clear the default content and type new content
      await user.clear(contentTextarea)
      await user.type(contentTextarea, 'Hello World!')

      expect(screen.getByText('12/100,000')).toBeInTheDocument()
    })
  })

  describe('form submission', () => {
    it('should submit create data for new prompt', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Fill in the form
      await user.type(screen.getByLabelText(/name/i), 'my-prompt')
      await user.type(screen.getByLabelText(/^title$/i), 'My Prompt')
      await user.type(screen.getByLabelText(/description/i), 'A description')
      // Clear default content and type new content
      const contentTextarea = screen.getByLabelText(/template content/i)
      await user.clear(contentTextarea)
      await user.type(contentTextarea, 'Hello world')

      // Submit
      await user.click(screen.getByRole('button', { name: /create prompt/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          name: 'my-prompt',
          title: 'My Prompt',
          description: 'A description',
          content: 'Hello world',
          tags: [],
        })
      })
    })

    it('should submit only changed fields for edit', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Only change the title
      const titleInput = screen.getByLabelText(/^title$/i)
      await user.clear(titleInput)
      await user.type(titleInput, 'Updated Title')

      // Submit
      await user.click(screen.getByRole('button', { name: /save changes/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          title: 'Updated Title',
        })
      })
    })

    it('should show Save Changes button when editing', () => {
      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /create prompt/i })).not.toBeInTheDocument()
    })

    it('should show spinner while submitting', async () => {
      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          isSubmitting={true}
        />
      )

      expect(screen.getByText(/saving/i)).toBeInTheDocument()
    })
  })

  describe('cancel behavior', () => {
    it('should call onCancel immediately when form is not dirty', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()

      // Use an existing prompt so the form matches the prompt data (not dirty)
      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={onCancel}
        />
      )

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onCancel).toHaveBeenCalled()
    })

    it('should show confirmation when form is dirty', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={onCancel}
        />
      )

      // Make the form dirty
      await user.type(screen.getByLabelText(/name/i), 'test')

      // First click shows confirmation
      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onCancel).not.toHaveBeenCalled()
      expect(screen.getByText(/discard changes/i)).toBeInTheDocument()

      // Second click confirms
      await user.click(screen.getByRole('button', { name: /discard changes/i }))

      expect(onCancel).toHaveBeenCalled()
    })
  })

  describe('header action buttons', () => {
    it('should show archive button when onArchive provided', () => {
      const onArchive = vi.fn()

      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          onArchive={onArchive}
        />
      )

      expect(screen.getByRole('button', { name: /archive/i })).toBeInTheDocument()
    })

    it('should show delete button when onDelete provided', () => {
      const onDelete = vi.fn()

      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          onDelete={onDelete}
        />
      )

      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('should call onArchive when archive button clicked', async () => {
      const user = userEvent.setup()
      const onArchive = vi.fn()

      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          onArchive={onArchive}
        />
      )

      await user.click(screen.getByRole('button', { name: /archive/i }))

      expect(onArchive).toHaveBeenCalled()
    })
  })

  describe('draft handling', () => {
    it('should save draft to localStorage', async () => {
      const user = userEvent.setup()
      vi.useFakeTimers({ shouldAdvanceTime: true })

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      // Make the form dirty
      await user.type(screen.getByLabelText(/name/i), 'draft-test')

      // Fast-forward 30+ seconds for auto-save
      vi.advanceTimersByTime(31000)

      // Check localStorage
      const draft = localStorage.getItem('prompt_draft_new')
      expect(draft).toBeTruthy()

      const parsed = JSON.parse(draft!)
      expect(parsed.name).toBe('draft-test')

      vi.useRealTimers()
    })

    it('should show draft restoration prompt when draft exists', () => {
      // Pre-populate localStorage with a draft
      const draftData = {
        name: 'saved-draft',
        title: 'Saved Draft Title',
        description: '',
        content: '',
        arguments: [],
        tags: [],
        savedAt: Date.now(),
      }
      localStorage.setItem('prompt_draft_new', JSON.stringify(draftData))

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      expect(screen.getByText(/you have an unsaved draft/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /restore draft/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
    })

    it('should restore draft when Restore Draft is clicked', async () => {
      const user = userEvent.setup()

      // Pre-populate localStorage with a draft
      const draftData = {
        name: 'restored-prompt',
        title: 'Restored Title',
        description: 'Restored description',
        content: 'Restored content',
        arguments: [],
        tags: ['restored-tag'],
        savedAt: Date.now(),
      }
      localStorage.setItem('prompt_draft_new', JSON.stringify(draftData))

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /restore draft/i }))

      // Verify the form is populated with draft values
      expect(screen.getByLabelText(/name/i)).toHaveValue('restored-prompt')
      expect(screen.getByLabelText(/^title$/i)).toHaveValue('Restored Title')
      expect(screen.getByLabelText(/description/i)).toHaveValue('Restored description')
      expect(screen.getByLabelText(/template content/i)).toHaveValue('Restored content')

      // Draft prompt should be hidden
      expect(screen.queryByText(/you have an unsaved draft/i)).not.toBeInTheDocument()
    })

    it('should discard draft when Discard is clicked', async () => {
      const user = userEvent.setup()

      // Pre-populate localStorage with a draft
      const draftData = {
        name: 'to-discard',
        title: '',
        description: '',
        content: '',
        arguments: [],
        tags: [],
        savedAt: Date.now(),
      }
      localStorage.setItem('prompt_draft_new', JSON.stringify(draftData))

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /^discard$/i }))

      // Draft prompt should be hidden
      expect(screen.queryByText(/you have an unsaved draft/i)).not.toBeInTheDocument()

      // localStorage should be cleared
      expect(localStorage.getItem('prompt_draft_new')).toBeNull()
    })

    it('should clear draft on successful submit', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn().mockResolvedValue(undefined)

      // Pre-populate localStorage with a draft
      localStorage.setItem('prompt_draft_new', JSON.stringify({
        name: 'test',
        title: '',
        description: '',
        content: '',
        arguments: [],
        tags: [],
        savedAt: Date.now(),
      }))

      render(
        <PromptEditor
          tagSuggestions={mockTagSuggestions}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />
      )

      // Fill in name and set simple content (content is required)
      await user.type(screen.getByLabelText(/name/i), 'submit-test')
      const contentEditor = screen.getByTestId('markdown-editor')
      await user.clear(contentEditor)
      await user.type(contentEditor, 'Test content')
      await user.click(screen.getByRole('button', { name: /create prompt/i }))

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled()
      })

      // Draft should be cleared
      expect(localStorage.getItem('prompt_draft_new')).toBeNull()
    })
  })

  describe('editing existing prompt', () => {
    it('should populate form with existing prompt data', () => {
      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      // Use exact label match or input id to avoid collision with argument fields
      expect(screen.getByRole('textbox', { name: /^name/i })).toHaveValue('test-prompt')
      expect(screen.getByLabelText(/^title$/i)).toHaveValue('Test Prompt')
      expect(screen.getByLabelText(/^description$/i)).toHaveValue('A test description')
      expect(screen.getByLabelText(/template content/i)).toHaveValue('Hello {{ name }}')
    })

    it('should show existing arguments', () => {
      render(
        <PromptEditor
          prompt={mockPrompt}
          tagSuggestions={mockTagSuggestions}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      // Should show the argument from mockPrompt
      const argInput = screen.getByDisplayValue('name')
      expect(argInput).toBeInTheDocument()

      const requiredCheckbox = screen.getByLabelText(/required/i)
      expect(requiredCheckbox).toBeChecked()
    })
  })
})
