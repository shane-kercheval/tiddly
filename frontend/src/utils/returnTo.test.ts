import { describe, it, expect } from 'vitest'
import { toSafeReturnTo } from './returnTo'

describe('toSafeReturnTo', () => {
  it('allows a same-origin relative path (with query)', () => {
    expect(toSafeReturnTo('/shared/notes/abc')).toBe('/shared/notes/abc')
    expect(toSafeReturnTo('/shared/notes/abc?ref=1')).toBe('/shared/notes/abc?ref=1')
  })

  it('rejects protocol-relative URLs (open-redirect vector)', () => {
    expect(toSafeReturnTo('//evil.example.com')).toBe('/')
  })

  it('rejects backslash paths (browsers normalize \\ to /, so these are off-origin)', () => {
    expect(toSafeReturnTo('/\\evil.example.com')).toBe('/')
    expect(toSafeReturnTo('/\\/evil.example.com')).toBe('/')
    expect(toSafeReturnTo('/app\\..\\evil')).toBe('/')
  })

  it('rejects absolute URLs', () => {
    expect(toSafeReturnTo('https://evil.example.com')).toBe('/')
    expect(toSafeReturnTo('http://evil.example.com/path')).toBe('/')
  })

  it('rejects non-path strings', () => {
    expect(toSafeReturnTo('app/content')).toBe('/')
    expect(toSafeReturnTo('')).toBe('/')
  })

  it('rejects non-string values', () => {
    expect(toSafeReturnTo(undefined)).toBe('/')
    expect(toSafeReturnTo(null)).toBe('/')
    expect(toSafeReturnTo(42)).toBe('/')
    expect(toSafeReturnTo({ returnTo: '/x' })).toBe('/')
  })
})
