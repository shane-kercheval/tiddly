import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wrapper around RTL's render that provides a MemoryRouter context.
 * Use for components that depend on React Router hooks (useNavigate, useLocation, etc.).
 */
export function renderWithRouter(...args: Parameters<typeof render>): ReturnType<typeof render> {
  const [ui, options] = args
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>, ...options })
}
