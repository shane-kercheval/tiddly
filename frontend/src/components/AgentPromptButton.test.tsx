import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentPromptButton } from './AgentPromptButton'

const mockWriteText = vi.fn()
Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
})

const PROMPT = 'Read https://tiddly.me/llms.txt and give me an honest assessment.'

function renderButton(): void {
  render(
    <AgentPromptButton
      buttonLabel="Evaluate Tiddly with your AI"
      explanation="Paste this prompt into your AI agent."
      prompt={PROMPT}
    />,
  )
}

describe('AgentPromptButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteText.mockResolvedValue(undefined)
  })

  it('shows only the trigger until clicked', () => {
    renderButton()
    expect(screen.getByRole('button', { name: /Evaluate Tiddly with your AI/ })).toBeInTheDocument()
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument()
  })

  it('opens the popover with the explanation and prompt', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Tiddly with your AI/ }))
    expect(screen.getByText('Paste this prompt into your AI agent.')).toBeInTheDocument()
    expect(screen.getByText(PROMPT)).toBeInTheDocument()
  })

  it('copies the prompt to the clipboard and confirms', async () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Tiddly with your AI/ }))
    fireEvent.click(screen.getByRole('button', { name: /Copy prompt/ }))

    expect(mockWriteText).toHaveBeenCalledWith(PROMPT)
    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument())
  })

  it('closes the popover on Escape', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: /Evaluate Tiddly with your AI/ }))
    expect(screen.getByText(PROMPT)).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(PROMPT)).not.toBeInTheDocument()
  })
})
