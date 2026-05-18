import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createElement, type ReactNode } from 'react'
import { useHashScroll } from './useHashScroll'

function wrapperFor(initialEntry: string): (props: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }) {
    return createElement(MemoryRouter, { initialEntries: [initialEntry] }, children)
  }
}

describe('useHashScroll', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('scrolls the matching element into view on initial mount when hash is present', () => {
    const target = document.createElement('div')
    target.id = 'tip-foo'
    document.body.appendChild(target)

    renderHook(() => useHashScroll(), {
      wrapper: wrapperFor('/docs/tips#tip-foo'),
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(target)
  })

  it('does nothing when there is no hash on the URL', () => {
    renderHook(() => useHashScroll(), {
      wrapper: wrapperFor('/docs/tips'),
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not throw when the hash points at an element that does not exist', () => {
    expect(() => {
      renderHook(() => useHashScroll(), {
        wrapper: wrapperFor('/docs/tips#tip-nonexistent'),
      })
    }).not.toThrow()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('uses the prefixed `tip-<id>` form locked in M2 (does not re-strip a prefix)', () => {
    // Sanity check: the hook strips the leading "#" only — it does not
    // additionally strip "tip-". So `#tip-foo` matches `id="tip-foo"`.
    const prefixed = document.createElement('div')
    prefixed.id = 'tip-foo'
    document.body.appendChild(prefixed)

    const unprefixed = document.createElement('div')
    unprefixed.id = 'foo'
    document.body.appendChild(unprefixed)

    renderHook(() => useHashScroll(), {
      wrapper: wrapperFor('/docs/tips#tip-foo'),
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(prefixed)
  })
})
