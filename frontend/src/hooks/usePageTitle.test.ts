import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePageTitle } from './usePageTitle'

describe('usePageTitle', () => {
  afterEach(() => {
    document.title = ''
  })

  it('test__usePageTitle__sets_title_with_suffix', () => {
    renderHook(() => usePageTitle('Settings'))

    expect(document.title).toBe('Settings - Tiddly')
  })

  it('test__usePageTitle__shows_base_title_when_undefined', () => {
    renderHook(() => usePageTitle(undefined))

    expect(document.title).toBe('Tiddly')
  })

  it('test__usePageTitle__resets_title_on_unmount', () => {
    const { unmount } = renderHook(() => usePageTitle('My Note'))

    expect(document.title).toBe('My Note - Tiddly')

    unmount()

    expect(document.title).toBe('Tiddly')
  })

  it('test__usePageTitle__updates_title_when_value_changes', () => {
    const { rerender } = renderHook(
      ({ title }: { title: string | undefined }) => usePageTitle(title),
      { initialProps: { title: 'First' } }
    )

    expect(document.title).toBe('First - Tiddly')

    rerender({ title: 'Second' })

    expect(document.title).toBe('Second - Tiddly')
  })
})
