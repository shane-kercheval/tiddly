/**
 * Tests for CharacterLimitFeedback component.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CharacterLimitFeedback } from './CharacterLimitFeedback'
import type { CharacterLimitResult } from '../hooks/useCharacterLimit'

function makeLimitResult(overrides: Partial<CharacterLimitResult> = {}): CharacterLimitResult {
  return {
    exceeded: false,
    showCounter: false,
    counterText: '',
    message: undefined,
    color: '',
    ...overrides,
  }
}

describe('CharacterLimitFeedback', () => {
  it('should render with visibility hidden when showCounter is false', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult()} />)

    const el = screen.getByTestId('character-limit-feedback')
    expect(el.style.visibility).toBe('hidden')
  })

  it('should render with visibility visible when showCounter is true', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult({ showCounter: true, counterText: '70 / 100', color: '#9ca3af' })} />)

    const el = screen.getByTestId('character-limit-feedback')
    expect(el.style.visibility).toBe('visible')
  })

  it('should show counter text on the right', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult({ showCounter: true, counterText: '85 / 100', color: '#d97706' })} />)

    expect(screen.getByText('85 / 100')).toBeInTheDocument()
  })

  it('should show message on the left when provided', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult({
      showCounter: true,
      counterText: '100 / 100',
      message: 'Character limit reached',
      color: '#dc2626',
    })} />)

    expect(screen.getByText('Character limit reached')).toBeInTheDocument()
    expect(screen.getByText('100 / 100')).toBeInTheDocument()
  })

  it('should not render message text when message is undefined', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult({
      showCounter: true,
      counterText: '70 / 100',
      color: '#9ca3af',
    })} />)

    // Left span should be empty
    const el = screen.getByTestId('character-limit-feedback')
    const spans = el.querySelectorAll('span')
    expect(spans[0].textContent).toBe('')
    expect(spans[1].textContent).toBe('70 / 100')
  })

  it('should apply color via inline style', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult({
      showCounter: true,
      counterText: '85 / 100',
      color: '#d97706',
    })} />)

    const el = screen.getByTestId('character-limit-feedback')
    // jsdom normalizes hex to rgb
    expect(el.style.color).toBe('rgb(217, 119, 6)')
  })

  it('should apply custom className', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult()} className="mt-2" />)

    const el = screen.getByTestId('character-limit-feedback')
    expect(el.className).toContain('mt-2')
  })

  it('should reserve space with fixed height even when hidden', () => {
    render(<CharacterLimitFeedback limit={makeLimitResult()} />)

    const el = screen.getByTestId('character-limit-feedback')
    expect(el.className).toContain('h-4')
  })
})
