import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsAIChatGPT } from './DocsAIChatGPT'
import { DocsAIGeminiCLI } from './DocsAIGeminiCLI'

describe('DocsAIChatGPT', () => {
  it('should show Coming Soon with OAuth mention', () => {
    render(
      <MemoryRouter>
        <DocsAIChatGPT />
      </MemoryRouter>
    )

    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.getByText('Coming Soon')).toBeInTheDocument()
    expect(screen.getByText(/OAuth/)).toBeInTheDocument()
  })
})

describe('DocsAIGeminiCLI', () => {
  it('should show Coming Soon message', () => {
    render(
      <MemoryRouter>
        <DocsAIGeminiCLI />
      </MemoryRouter>
    )

    expect(screen.getByText('Gemini CLI')).toBeInTheDocument()
    expect(screen.getByText('Coming Soon')).toBeInTheDocument()
  })
})
