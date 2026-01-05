/**
 * Tests for MarkdownEditor component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MarkdownEditor } from './MarkdownEditor'

// Mock CodeMirror since it has complex DOM interactions
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange, placeholder }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <textarea
      data-testid="codemirror-mock"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

describe('MarkdownEditor', () => {
  const defaultProps = {
    value: 'Test content',
    onChange: vi.fn(),
  }

  describe('wrap text toggle', () => {
    it('should not render wrap checkbox when onWrapTextChange is not provided', () => {
      render(<MarkdownEditor {...defaultProps} />)

      expect(screen.queryByLabelText('Wrap')).not.toBeInTheDocument()
    })

    it('should render wrap checkbox when onWrapTextChange is provided', () => {
      render(
        <MarkdownEditor
          {...defaultProps}
          wrapText={false}
          onWrapTextChange={vi.fn()}
        />
      )

      expect(screen.getByLabelText('Wrap')).toBeInTheDocument()
    })

    it('should show wrap checkbox as checked when wrapText is true', () => {
      render(
        <MarkdownEditor
          {...defaultProps}
          wrapText={true}
          onWrapTextChange={vi.fn()}
        />
      )

      expect(screen.getByLabelText('Wrap')).toBeChecked()
    })

    it('should show wrap checkbox as unchecked when wrapText is false', () => {
      render(
        <MarkdownEditor
          {...defaultProps}
          wrapText={false}
          onWrapTextChange={vi.fn()}
        />
      )

      expect(screen.getByLabelText('Wrap')).not.toBeChecked()
    })

    it('should call onWrapTextChange when wrap checkbox is clicked', async () => {
      const onWrapTextChange = vi.fn()
      const user = userEvent.setup()

      render(
        <MarkdownEditor
          {...defaultProps}
          wrapText={false}
          onWrapTextChange={onWrapTextChange}
        />
      )

      await user.click(screen.getByLabelText('Wrap'))

      expect(onWrapTextChange).toHaveBeenCalledWith(true)
    })

    it('should call onWrapTextChange with false when unchecking', async () => {
      const onWrapTextChange = vi.fn()
      const user = userEvent.setup()

      render(
        <MarkdownEditor
          {...defaultProps}
          wrapText={true}
          onWrapTextChange={onWrapTextChange}
        />
      )

      await user.click(screen.getByLabelText('Wrap'))

      expect(onWrapTextChange).toHaveBeenCalledWith(false)
    })
  })

  describe('edit/preview mode switching', () => {
    it('should show editor by default (edit mode)', () => {
      render(<MarkdownEditor {...defaultProps} />)

      expect(screen.getByTestId('codemirror-mock')).toBeVisible()
      expect(screen.queryByText('No content to preview')).not.toBeInTheDocument()
    })

    it('should keep editor in DOM when switching to preview mode', async () => {
      const user = userEvent.setup()

      render(<MarkdownEditor {...defaultProps} />)

      // Switch to preview
      await user.click(screen.getByRole('button', { name: 'Preview' }))

      // Editor should still be in DOM (just hidden)
      expect(screen.getByTestId('codemirror-mock')).toBeInTheDocument()
    })

    it('should hide editor container when in preview mode', async () => {
      const user = userEvent.setup()

      render(<MarkdownEditor {...defaultProps} />)

      // Switch to preview
      await user.click(screen.getByRole('button', { name: 'Preview' }))

      // Editor container should have 'hidden' class
      const editorContainer = screen.getByTestId('codemirror-mock').parentElement
      expect(editorContainer).toHaveClass('hidden')
    })

    it('should show editor container when switching back to edit mode', async () => {
      const user = userEvent.setup()

      render(<MarkdownEditor {...defaultProps} />)

      // Switch to preview, then back to edit
      await user.click(screen.getByRole('button', { name: 'Preview' }))
      await user.click(screen.getByRole('button', { name: 'Edit' }))

      // Editor container should not have 'hidden' class
      const editorContainer = screen.getByTestId('codemirror-mock').parentElement
      expect(editorContainer).not.toHaveClass('hidden')
    })

    it('should show rendered content in preview mode', async () => {
      const user = userEvent.setup()

      render(<MarkdownEditor {...defaultProps} value="**Bold text**" />)

      await user.click(screen.getByRole('button', { name: 'Preview' }))

      // ReactMarkdown should render the bold text
      expect(screen.getByText('Bold text')).toBeInTheDocument()
    })

    it('should show empty state in preview when no content', async () => {
      const user = userEvent.setup()

      render(<MarkdownEditor {...defaultProps} value="" />)

      await user.click(screen.getByRole('button', { name: 'Preview' }))

      expect(screen.getByText('No content to preview')).toBeInTheDocument()
    })
  })

  describe('basic rendering', () => {
    it('should render with custom label', () => {
      render(<MarkdownEditor {...defaultProps} label="Custom Label" />)

      expect(screen.getByText('Custom Label')).toBeInTheDocument()
    })

    it('should render helper text', () => {
      render(<MarkdownEditor {...defaultProps} helperText="Custom helper" />)

      expect(screen.getByText('Custom helper')).toBeInTheDocument()
    })

    it('should render error message instead of helper text when provided', () => {
      render(
        <MarkdownEditor
          {...defaultProps}
          helperText="Helper"
          errorMessage="Error message"
        />
      )

      expect(screen.getByText('Error message')).toBeInTheDocument()
      expect(screen.queryByText('Helper')).not.toBeInTheDocument()
    })

    it('should render character counter when maxLength is provided', () => {
      render(<MarkdownEditor {...defaultProps} value="Hello" maxLength={1000} />)

      expect(screen.getByText('5/1,000')).toBeInTheDocument()
    })

    it('should apply error styling when hasError is true', () => {
      render(<MarkdownEditor {...defaultProps} hasError={true} />)

      const editorContainer = screen.getByTestId('codemirror-mock').parentElement
      expect(editorContainer).toHaveClass('border-red-300')
    })
  })
})
