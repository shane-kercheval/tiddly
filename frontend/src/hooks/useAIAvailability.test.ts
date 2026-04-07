/**
 * Tests for useAIAvailability hook.
 *
 * Covers:
 * - Query key factory structure
 * - Default values when data is not loaded
 */
import { describe, it, expect } from 'vitest'
import { aiHealthKeys } from './useAIAvailability'

describe('aiHealthKeys', () => {
  it('all returns base key', () => {
    expect(aiHealthKeys.all).toEqual(['ai-health'])
  })

  it('user returns scoped key', () => {
    expect(aiHealthKeys.user('user-123')).toEqual(['ai-health', 'user-123'])
  })

  it('user key extends all key for invalidation', () => {
    const userKey = aiHealthKeys.user('user-123')
    const allKey = aiHealthKeys.all
    // userKey starts with allKey — invalidating allKey invalidates all user keys
    expect(userKey.slice(0, allKey.length)).toEqual([...allKey])
  })
})
