import { describe, it, expect } from 'vitest'
import { computeDropdownLeft } from './dropdownPosition'

describe('computeDropdownLeft', () => {
  // -----------------------------------------------------------------------
  // Non-mobile, AI disabled (narrow dropdown fits left-aligned)
  // -----------------------------------------------------------------------
  describe('narrow dropdown (170px) on wide viewport (1400px)', () => {
    const dropdownWidth = 170
    const viewportWidth = 1400

    it('left-aligns when input is on the right side of the card', () => {
      // Input at right side: left=1200, right=1300
      // 1200 + 170 = 1370 <= 1400 → fits left-aligned
      const result = computeDropdownLeft(1200, 1300, dropdownWidth, viewportWidth)
      expect(result).toBe(1200)
    })

    it('left-aligns when input is on the left side of the card', () => {
      // Input at left side: left=50, right=150
      const result = computeDropdownLeft(50, 150, dropdownWidth, viewportWidth)
      expect(result).toBe(50)
    })

    it('right-aligns when input is at far right and left-align would overflow', () => {
      // Input at far right: left=1280, right=1380
      // 1280 + 170 = 1450 > 1400 → overflow right → try right-align
      // 1380 - 170 = 1210 >= 0 → right-align works
      const result = computeDropdownLeft(1280, 1380, dropdownWidth, viewportWidth)
      expect(result).toBe(1210)
    })
  })

  // -----------------------------------------------------------------------
  // Non-mobile, AI enabled (wide dropdown needs right-alignment)
  // -----------------------------------------------------------------------
  describe('wide dropdown (340px) on wide viewport (1400px)', () => {
    const dropdownWidth = 340
    const viewportWidth = 1400

    it('right-aligns when input is on the right side and left-align would overflow', () => {
      // Input at right side: left=1200, right=1300
      // 1200 + 340 = 1540 > 1400 → overflow right → try right-align
      // 1300 - 340 = 960 >= 0 → right-align works
      const result = computeDropdownLeft(1200, 1300, dropdownWidth, viewportWidth)
      expect(result).toBe(960)
    })

    it('left-aligns when input is on the left side and dropdown fits', () => {
      // Input at left side: left=50, right=150
      // 50 + 340 = 390 <= 1400 → fits left-aligned
      const result = computeDropdownLeft(50, 150, dropdownWidth, viewportWidth)
      expect(result).toBe(50)
    })

    it('left-aligns when input is in the middle and dropdown fits', () => {
      // Input in middle: left=500, right=600
      // 500 + 340 = 840 <= 1400 → fits
      const result = computeDropdownLeft(500, 600, dropdownWidth, viewportWidth)
      expect(result).toBe(500)
    })
  })

  // -----------------------------------------------------------------------
  // Mobile, AI disabled (narrow dropdown on narrow viewport)
  // -----------------------------------------------------------------------
  describe('narrow dropdown (170px) on mobile viewport (375px)', () => {
    const dropdownWidth = 170
    const viewportWidth = 375

    it('left-aligns when input is on the left side', () => {
      // Mobile: input at left: left=16, right=112
      // 16 + 170 = 186 <= 375 → fits
      const result = computeDropdownLeft(16, 112, dropdownWidth, viewportWidth)
      expect(result).toBe(16)
    })

    it('right-aligns when input is on the right and left-align would overflow', () => {
      // Mobile: input at right: left=260, right=356
      // 260 + 170 = 430 > 375 → overflow right → try right-align
      // 356 - 170 = 186 >= 0 → works
      const result = computeDropdownLeft(260, 356, dropdownWidth, viewportWidth)
      expect(result).toBe(186)
    })
  })

  // -----------------------------------------------------------------------
  // Mobile, AI enabled (wide dropdown on narrow viewport)
  // -----------------------------------------------------------------------
  describe('wide dropdown (340px) on mobile viewport (375px)', () => {
    const dropdownWidth = 340
    const viewportWidth = 375

    it('left-aligns when input is on the left side and dropdown barely fits', () => {
      // Mobile: input at left: left=16, right=112
      // 16 + 340 = 356 <= 375 → fits
      const result = computeDropdownLeft(16, 112, dropdownWidth, viewportWidth)
      expect(result).toBe(16)
    })

    it('right-aligns when left-align would overflow', () => {
      // Mobile: input slightly right: left=50, right=146
      // 50 + 340 = 390 > 375 → overflow → try right-align
      // 146 - 340 = -194 < 0 → right-align also overflows → clamp to 0
      const result = computeDropdownLeft(50, 146, dropdownWidth, viewportWidth)
      expect(result).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('clamps to 0 when dropdown is wider than viewport', () => {
      // Dropdown 400px, viewport 375px, input at left=0, right=96
      // 0 + 400 = 400 > 375 → overflow right
      // 96 - 400 = -304 < 0 → overflow left
      // clamp to 0
      const result = computeDropdownLeft(0, 96, 400, 375)
      expect(result).toBe(0)
    })

    it('left-aligns exactly at viewport edge', () => {
      // Input at left=0, right=96, dropdown=170, viewport=170
      // 0 + 170 = 170 <= 170 → fits exactly
      const result = computeDropdownLeft(0, 96, 170, 170)
      expect(result).toBe(0)
    })

    it('right-aligns exactly at left edge', () => {
      // Input: left=340, right=400, dropdown=340, viewport=400
      // 340 + 340 = 680 > 400 → overflow right
      // 400 - 340 = 60 >= 0 → right-align at 60
      const result = computeDropdownLeft(340, 400, 340, 400)
      expect(result).toBe(60)
    })

    it('handles zero-width dropdown', () => {
      const result = computeDropdownLeft(100, 200, 0, 1400)
      expect(result).toBe(100)
    })
  })
})
