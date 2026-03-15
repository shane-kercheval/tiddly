import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsCLIHub } from './DocsCLIHub'

beforeAll(() => {
  // CLIPromptAnimation uses framer-motion which requires IntersectionObserver
  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class IntersectionObserver {
      observe(): void { /* noop */ }
      unobserve(): void { /* noop */ }
      disconnect(): void { /* noop */ }
    } as unknown as typeof globalThis.IntersectionObserver
  }
})

function renderPage(): void {
  render(
    <MemoryRouter>
      <DocsCLIHub />
    </MemoryRouter>
  )
}

describe('DocsCLIHub', () => {
  it('should reference tiddly update, not tiddly upgrade', () => {
    renderPage()
    expect(screen.getByText('tiddly update')).toBeInTheDocument()
    expect(screen.queryByText('tiddly upgrade')).not.toBeInTheDocument()
  })
})
