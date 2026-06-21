import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders title and icon', () => {
    render(<EmptyState icon={<svg data-testid="icon" />} title="Nothing here" />)
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeInTheDocument()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders the description paragraph when description is non-empty', () => {
    render(
      <EmptyState
        icon={<svg />}
        title="Nothing here"
        description="Try something else."
      />,
    )
    expect(screen.getByText('Try something else.')).toBeInTheDocument()
  })

  it('omits the description paragraph when description is empty or undefined', () => {
    // The filter describe utilities frequently return empty descriptions because
    // the descriptive copy lives in the title. The empty <p> would add
    // unwanted vertical whitespace between title and actions.
    const { container, rerender } = render(<EmptyState icon={<svg />} title="No description" />)
    expect(container.querySelector('p')).toBeNull()
    rerender(<EmptyState icon={<svg />} title="Empty string" description="" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders children between description and actions', () => {
    // Pinned ordering: title → description → children → actions. This is
    // load-bearing for actionable hints (which sit above CTAs) and starter
    // tip cards (which inform the user before they pick an action).
    const { container } = render(
      <EmptyState
        icon={<svg />}
        title="No content"
        description="Try this."
        actions={[{ label: 'Create', onClick: () => {} }]}
      >
        <div data-testid="hint">Hint content</div>
      </EmptyState>,
    )

    const root = container.firstElementChild!
    const orderedRoles = Array.from(root.children).map((node) => {
      if (node.tagName === 'H3') return 'title'
      if (node.tagName === 'P') return 'description'
      if (node.getAttribute('data-testid') === 'hint') return 'children'
      if (node.querySelector('button')) return 'actions'
      return 'other'
    })
    const titleIndex = orderedRoles.indexOf('title')
    const descriptionIndex = orderedRoles.indexOf('description')
    const childrenIndex = orderedRoles.indexOf('children')
    const actionsIndex = orderedRoles.indexOf('actions')
    expect(titleIndex).toBeLessThan(descriptionIndex)
    expect(descriptionIndex).toBeLessThan(childrenIndex)
    expect(childrenIndex).toBeLessThan(actionsIndex)
  })

  it('renders actions from `actions` prop', () => {
    render(
      <EmptyState
        icon={<svg />}
        title="No content"
        actions={[
          { label: 'First', onClick: () => {} },
          { label: 'Second', onClick: () => {} },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: 'First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument()
  })

  it('renders a single action from the legacy `action` prop', () => {
    render(
      <EmptyState
        icon={<svg />}
        title="No content"
        action={{ label: 'Solo', onClick: () => {} }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument()
  })

  it('renders footer below the action row', () => {
    // The footer hosts secondary affordances (e.g. the first-run orientation
    // prompt) that must follow the primary "New …" action buttons.
    const { container } = render(
      <EmptyState
        icon={<svg />}
        title="No content"
        actions={[{ label: 'Create', onClick: () => {} }]}
        footer={<div data-testid="footer">Footer content</div>}
      />,
    )
    expect(screen.getByTestId('footer')).toBeInTheDocument()

    const root = container.firstElementChild!
    const orderedRoles = Array.from(root.children).map((node) => {
      if (node.getAttribute('data-testid') === 'footer') return 'footer'
      if (node.querySelector('button')) return 'actions'
      return 'other'
    })
    expect(orderedRoles.indexOf('actions')).toBeLessThan(orderedRoles.indexOf('footer'))
  })
})
