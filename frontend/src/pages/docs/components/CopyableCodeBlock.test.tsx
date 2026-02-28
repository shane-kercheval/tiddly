import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyableCodeBlock } from './CopyableCodeBlock'

const mockWriteText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  mockWriteText.mockClear()
  mockWriteText.mockResolvedValue(undefined)
  // Assign clipboard mock using Object.assign to avoid property definition issues
  Object.assign(navigator, {
    clipboard: { writeText: mockWriteText },
  })
})

describe('CopyableCodeBlock', () => {
  it('should render code content', () => {
    render(<CopyableCodeBlock code="echo hello" />)
    expect(screen.getByText('echo hello')).toBeInTheDocument()
  })

  it('should copy text to clipboard on button click', async () => {
    render(<CopyableCodeBlock code="echo hello" />)

    fireEvent.click(screen.getByText('Copy'))

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('echo hello')
    })
  })

  it('should show Copied! feedback after clicking', async () => {
    render(<CopyableCodeBlock code="echo hello" />)

    fireEvent.click(screen.getByText('Copy'))

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('should not crash on clipboard failure', async () => {
    mockWriteText.mockRejectedValue(new Error('Clipboard failed'))
    render(<CopyableCodeBlock code="echo hello" />)

    fireEvent.click(screen.getByText('Copy'))

    // Component should still be rendered without crashing
    // Wait a tick for the promise rejection to be handled
    await waitFor(() => {
      expect(screen.getByText('echo hello')).toBeInTheDocument()
    })
  })
})
