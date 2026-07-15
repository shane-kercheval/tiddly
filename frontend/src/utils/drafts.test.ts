import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DRAFT_KEY_PREFIX, draftKey, clearAllDrafts } from './drafts'

describe('drafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('draftKey builds prefixed, typed keys', () => {
    expect(draftKey('note', 'abc')).toBe(`${DRAFT_KEY_PREFIX}note:abc`)
    expect(draftKey('bookmark', 'new')).toBe('tiddly:draft:bookmark:new')
    expect(draftKey('prompt', 'id-1')).toBe('tiddly:draft:prompt:id-1')
  })

  it('clearAllDrafts removes only draft-prefixed keys, leaving other state intact', () => {
    localStorage.setItem(draftKey('note', '1'), 'a')
    localStorage.setItem(draftKey('bookmark', 'new'), 'b')
    localStorage.setItem('unrelated:key', 'keep')
    localStorage.setItem('tiddly:other', 'keep2') // tiddly-namespaced but not a draft

    clearAllDrafts()

    expect(localStorage.getItem(draftKey('note', '1'))).toBeNull()
    expect(localStorage.getItem(draftKey('bookmark', 'new'))).toBeNull()
    expect(localStorage.getItem('unrelated:key')).toBe('keep')
    expect(localStorage.getItem('tiddly:other')).toBe('keep2')
  })

  it('clearAllDrafts is best-effort — a storage error does not throw', () => {
    localStorage.setItem(draftKey('note', '1'), 'a')
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    expect(() => clearAllDrafts()).not.toThrow()

    spy.mockRestore()
  })
})
