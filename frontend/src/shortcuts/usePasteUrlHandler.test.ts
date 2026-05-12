import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePasteUrlHandler } from './usePasteUrlHandler'

function createPasteEvent(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  ;(event as Event & { clipboardData: DataTransfer }).clipboardData = {
    getData: () => text,
  } as unknown as DataTransfer
  return event
}

describe('usePasteUrlHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })

  it('fires onPasteUrl with a valid URL pasted outside inputs', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    document.dispatchEvent(createPasteEvent('https://example.com'))

    expect(onPasteUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('trims whitespace before invoking the handler', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    document.dispatchEvent(createPasteEvent('  https://example.com  '))

    expect(onPasteUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('does not fire on non-URL plain text', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    document.dispatchEvent(createPasteEvent('just some random text'))

    expect(onPasteUrl).not.toHaveBeenCalled()
  })

  it('does not fire on a string that looks URL-shaped but has an invalid protocol', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    document.dispatchEvent(createPasteEvent('ftp://invalid.com'))

    expect(onPasteUrl).not.toHaveBeenCalled()
  })

  it('does not fire when an input is focused', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    document.dispatchEvent(createPasteEvent('https://example.com'))

    expect(onPasteUrl).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('does not fire when a textarea is focused', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    document.dispatchEvent(createPasteEvent('https://example.com'))

    expect(onPasteUrl).not.toHaveBeenCalled()
    document.body.removeChild(textarea)
  })

  it('does not fire on empty clipboard', () => {
    const onPasteUrl = vi.fn()
    renderHook(() => usePasteUrlHandler(onPasteUrl))

    document.dispatchEvent(createPasteEvent(''))

    expect(onPasteUrl).not.toHaveBeenCalled()
  })

  it('reads the latest handler through a ref (stable listener identity)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ handler }) => usePasteUrlHandler(handler),
      { initialProps: { handler: first } },
    )

    rerender({ handler: second })

    document.dispatchEvent(createPasteEvent('https://example.com'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
