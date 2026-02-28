import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IconWithBadge } from './IconWithBadge'

describe('IconWithBadge', () => {
  it('renders children and a plus badge', (): void => {
    render(
      <IconWithBadge>
        <span data-testid="child-icon">icon</span>
      </IconWithBadge>
    )

    expect(screen.getByTestId('child-icon')).toBeInTheDocument()
    // The plus badge is an SVG (PlusIcon) rendered inside the wrapper
    const wrapper = screen.getByTestId('child-icon').parentElement!
    const svg = wrapper.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('applies custom className to the wrapper', (): void => {
    const { container } = render(
      <IconWithBadge className="text-red-500">
        <span>icon</span>
      </IconWithBadge>
    )

    const wrapper = container.firstElementChild!
    expect(wrapper.className).toContain('text-red-500')
    expect(wrapper.className).toContain('relative')
    expect(wrapper.className).toContain('block')
  })
})
