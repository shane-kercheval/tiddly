/**
 * Tests for color interpolation utilities used in character limit feedback.
 */
import { describe, it, expect } from 'vitest'
import { lerpColor, getLimitColor, LIMIT_COLORS } from './limitFeedbackColor'

describe('lerpColor', () => {
  it('should return first color at t=0', () => {
    expect(lerpColor(LIMIT_COLORS.gray, LIMIT_COLORS.redLight, 0)).toBe('#d1d5db')
  })

  it('should return second color at t=1', () => {
    expect(lerpColor(LIMIT_COLORS.gray, LIMIT_COLORS.redLight, 1)).toBe('#dc2626')
  })

  it('should return midpoint at t=0.5', () => {
    const result = lerpColor([0, 0, 0], [200, 100, 50], 0.5)
    expect(result).toBe('#643219')
  })

  it('should clamp t below 0', () => {
    expect(lerpColor(LIMIT_COLORS.gray, LIMIT_COLORS.redLight, -1)).toBe('#d1d5db')
  })

  it('should clamp t above 1', () => {
    expect(lerpColor(LIMIT_COLORS.gray, LIMIT_COLORS.redLight, 2)).toBe('#dc2626')
  })
})

describe('getLimitColor', () => {
  describe('short fields (alwaysShow=false)', () => {
    it('should return gray at ratio 0.7 (light mode)', () => {
      expect(getLimitColor(0.7, false)).toBe('#d1d5db')
    })

    it('should return gray at ratio 0.7 (dark mode)', () => {
      expect(getLimitColor(0.7, true)).toBe('#d1d5db')
    })

    it('should return text color at ratio 0.85 (light mode)', () => {
      expect(getLimitColor(0.85, false)).toBe('#111827')
    })

    it('should return text color at ratio 0.85 (dark mode)', () => {
      expect(getLimitColor(0.85, true)).toBe('#e0e0e0')
    })

    it('should return orange at ratio just above 0.85 (light mode)', () => {
      // At 0.85 + tiny epsilon, should be very close to orange start
      const result = getLimitColor(0.851, false)
      expect(result).toMatch(/^#d[89a-f]/)
    })

    it('should return red at ratio 1.0 (light mode)', () => {
      expect(getLimitColor(1.0, false)).toBe('#dc2626')
    })

    it('should return red at ratio 1.0 (dark mode)', () => {
      expect(getLimitColor(1.0, true)).toBe('#fca5a5')
    })

    it('should clamp at ratio > 1.0 (returns red)', () => {
      expect(getLimitColor(1.5, false)).toBe('#dc2626')
    })

    it('should interpolate between gray and text in 0.7-0.85 range', () => {
      const atStart = getLimitColor(0.7, false)
      const atMid = getLimitColor(0.775, false)
      const atEnd = getLimitColor(0.85, false)
      // All should be different (progressive transition)
      expect(atStart).not.toBe(atMid)
      expect(atMid).not.toBe(atEnd)
    })

    it('should interpolate between orange and red in 0.85-1.0 range', () => {
      const atStart = getLimitColor(0.86, false)
      const atMid = getLimitColor(0.925, false)
      const atEnd = getLimitColor(1.0, false)
      expect(atStart).not.toBe(atMid)
      expect(atMid).not.toBe(atEnd)
    })
  })

  describe('content fields (alwaysShow=true)', () => {
    it('should return gray-400 below 0.85', () => {
      expect(getLimitColor(0.5, false, true)).toBe('#9ca3af')
      expect(getLimitColor(0.7, false, true)).toBe('#9ca3af')
      expect(getLimitColor(0.84, false, true)).toBe('#9ca3af')
    })

    it('should return orange at 0.85 (light mode)', () => {
      expect(getLimitColor(0.85, false, true)).toBe('#d97706')
    })

    it('should return red at 1.0 (light mode)', () => {
      expect(getLimitColor(1.0, false, true)).toBe('#dc2626')
    })

    it('should return red at 1.0 (dark mode)', () => {
      expect(getLimitColor(1.0, true, true)).toBe('#fca5a5')
    })

    it('should interpolate orange to red between 0.85 and 1.0', () => {
      const atStart = getLimitColor(0.86, false, true)
      const atEnd = getLimitColor(1.0, false, true)
      expect(atStart).not.toBe(atEnd)
    })
  })
})
