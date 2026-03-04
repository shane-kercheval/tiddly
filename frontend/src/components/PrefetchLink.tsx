/**
 * Link and NavLink wrappers that prefetch route chunks on hover/focus.
 */
import { Link, NavLink } from 'react-router-dom'
import type { ComponentProps } from 'react'
import { prefetchRoute } from '../routePrefetch'

type LinkProps = ComponentProps<typeof Link>
type NavLinkProps = ComponentProps<typeof NavLink>

export function PrefetchLink({ onMouseEnter, onFocus, to, ...rest }: LinkProps): React.ReactNode {
  const path = typeof to === 'string' ? to : to.pathname ?? ''

  const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    prefetchRoute(path)
    onMouseEnter?.(e)
  }

  const handleFocus = (e: React.FocusEvent<HTMLAnchorElement>): void => {
    prefetchRoute(path)
    onFocus?.(e)
  }

  return <Link to={to} onMouseEnter={handleMouseEnter} onFocus={handleFocus} {...rest} />
}

export function PrefetchNavLink({ onMouseEnter, onFocus, to, ...rest }: NavLinkProps): React.ReactNode {
  const path = typeof to === 'string' ? to : to.pathname ?? ''

  const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    prefetchRoute(path)
    onMouseEnter?.(e)
  }

  const handleFocus = (e: React.FocusEvent<HTMLAnchorElement>): void => {
    prefetchRoute(path)
    onFocus?.(e)
  }

  return <NavLink to={to} onMouseEnter={handleMouseEnter} onFocus={handleFocus} {...rest} />
}
