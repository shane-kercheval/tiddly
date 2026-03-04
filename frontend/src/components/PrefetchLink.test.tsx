/**
 * Tests for PrefetchLink and PrefetchNavLink components.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PrefetchLink, PrefetchNavLink } from './PrefetchLink'

vi.mock('../routePrefetch', () => ({
  prefetchRoute: vi.fn(),
}))

import { prefetchRoute } from '../routePrefetch'

const mockedPrefetchRoute = vi.mocked(prefetchRoute)

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('PrefetchLink', () => {
  it('should render a Link with correct props', () => {
    render(
      <PrefetchLink to="/test" className="my-class">
        Click me
      </PrefetchLink>,
      { wrapper: Wrapper }
    )

    const link = screen.getByRole('link', { name: 'Click me' })
    expect(link).toHaveAttribute('href', '/test')
    expect(link).toHaveClass('my-class')
  })

  it('should call prefetchRoute on mouseEnter', async () => {
    const user = userEvent.setup()
    render(
      <PrefetchLink to="/docs/features">Hover me</PrefetchLink>,
      { wrapper: Wrapper }
    )

    await user.hover(screen.getByRole('link'))
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/docs/features')
  })

  it('should call prefetchRoute on focus', () => {
    render(
      <PrefetchLink to="/pricing">Focus me</PrefetchLink>,
      { wrapper: Wrapper }
    )

    screen.getByRole('link').focus()
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/pricing')
  })

  it('should forward caller-provided onMouseEnter', async () => {
    const user = userEvent.setup()
    const onMouseEnter = vi.fn()

    render(
      <PrefetchLink to="/test" onMouseEnter={onMouseEnter}>
        Link
      </PrefetchLink>,
      { wrapper: Wrapper }
    )

    await user.hover(screen.getByRole('link'))
    expect(onMouseEnter).toHaveBeenCalledTimes(1)
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/test')
  })

  it('should forward caller-provided onFocus', () => {
    const onFocus = vi.fn()

    render(
      <PrefetchLink to="/test" onFocus={onFocus}>
        Link
      </PrefetchLink>,
      { wrapper: Wrapper }
    )

    screen.getByRole('link').focus()
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/test')
  })

  it('should handle object `to` prop', async () => {
    const user = userEvent.setup()

    render(
      <PrefetchLink to={{ pathname: '/app/notes' }}>Link</PrefetchLink>,
      { wrapper: Wrapper }
    )

    await user.hover(screen.getByRole('link'))
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/app/notes')
  })
})

describe('PrefetchNavLink', () => {
  it('should render a NavLink with correct props', () => {
    render(
      <PrefetchNavLink to="/settings" className="nav-class">
        Settings
      </PrefetchNavLink>,
      { wrapper: Wrapper }
    )

    const link = screen.getByRole('link', { name: 'Settings' })
    expect(link).toHaveAttribute('href', '/settings')
    expect(link).toHaveClass('nav-class')
  })

  it('should call prefetchRoute on mouseEnter', async () => {
    const user = userEvent.setup()
    render(
      <PrefetchNavLink to="/app/settings/tokens">Tokens</PrefetchNavLink>,
      { wrapper: Wrapper }
    )

    await user.hover(screen.getByRole('link'))
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/app/settings/tokens')
  })

  it('should call prefetchRoute on focus', () => {
    render(
      <PrefetchNavLink to="/app/content">Content</PrefetchNavLink>,
      { wrapper: Wrapper }
    )

    screen.getByRole('link').focus()
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/app/content')
  })

  it('should forward caller-provided onMouseEnter', async () => {
    const user = userEvent.setup()
    const onMouseEnter = vi.fn()

    render(
      <PrefetchNavLink to="/test" onMouseEnter={onMouseEnter}>
        Link
      </PrefetchNavLink>,
      { wrapper: Wrapper }
    )

    await user.hover(screen.getByRole('link'))
    expect(onMouseEnter).toHaveBeenCalledTimes(1)
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/test')
  })

  it('should forward caller-provided onFocus', () => {
    const onFocus = vi.fn()

    render(
      <PrefetchNavLink to="/test" onFocus={onFocus}>
        Link
      </PrefetchNavLink>,
      { wrapper: Wrapper }
    )

    screen.getByRole('link').focus()
    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(mockedPrefetchRoute).toHaveBeenCalledWith('/test')
  })
})
