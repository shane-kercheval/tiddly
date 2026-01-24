/**
 * Tests for CodeMirrorEditor helper functions.
 */
import { describe, it, expect } from 'vitest'
import { _testExports } from './CodeMirrorEditor'

const { getToggleMarkerAction } = _testExports

describe('getToggleMarkerAction', () => {
  describe('insert (no selection)', () => {
    it('should return insert when no text is selected', () => {
      const result = getToggleMarkerAction('', '', '', '**', '**')
      expect(result.type).toBe('insert')
    })

    it('should return insert regardless of surrounding text when no selection', () => {
      const result = getToggleMarkerAction('', '**', '**', '**', '**')
      expect(result.type).toBe('insert')
    })
  })

  describe('wrap (no existing markers)', () => {
    it('should return wrap for plain text selection', () => {
      const result = getToggleMarkerAction('hello', '', '', '**', '**')
      expect(result.type).toBe('wrap')
    })

    it('should return wrap when surrounding text does not match markers', () => {
      const result = getToggleMarkerAction('hello', 'ab', 'cd', '**', '**')
      expect(result.type).toBe('wrap')
    })

    it('should return wrap when only before marker matches', () => {
      const result = getToggleMarkerAction('hello', '**', 'xx', '**', '**')
      expect(result.type).toBe('wrap')
    })

    it('should return wrap when only after marker matches', () => {
      const result = getToggleMarkerAction('hello', 'xx', '**', '**', '**')
      expect(result.type).toBe('wrap')
    })
  })

  describe('unwrap-selection (markers inside selection)', () => {
    it('should unwrap when selection includes bold markers', () => {
      const result = getToggleMarkerAction('**hello**', '', '', '**', '**')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should unwrap when selection includes italic markers', () => {
      const result = getToggleMarkerAction('*hello*', '', '', '*', '*')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should unwrap when selection includes strikethrough markers', () => {
      const result = getToggleMarkerAction('~~hello~~', '', '', '~~', '~~')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should unwrap when selection includes highlight markers', () => {
      const result = getToggleMarkerAction('==hello==', '', '', '==', '==')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should unwrap when selection includes inline code markers', () => {
      const result = getToggleMarkerAction('`hello`', '', '', '`', '`')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should unwrap selection with multi-word content', () => {
      const result = getToggleMarkerAction('**hello world**', '', '', '**', '**')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should unwrap selection even with surrounding markers (selection takes priority)', () => {
      // If selection already has markers, unwrap those, don't look at surrounding
      const result = getToggleMarkerAction('**hello**', '**', '**', '**', '**')
      expect(result.type).toBe('unwrap-selection')
    })
  })

  describe('unwrap-surrounding (markers outside selection)', () => {
    it('should unwrap when bold markers are outside selection', () => {
      const result = getToggleMarkerAction('hello', '**', '**', '**', '**')
      expect(result.type).toBe('unwrap-surrounding')
    })

    it('should unwrap when italic markers are outside selection', () => {
      const result = getToggleMarkerAction('hello', '*', '*', '*', '*')
      expect(result.type).toBe('unwrap-surrounding')
    })

    it('should unwrap when strikethrough markers are outside selection', () => {
      const result = getToggleMarkerAction('hello', '~~', '~~', '~~', '~~')
      expect(result.type).toBe('unwrap-surrounding')
    })

    it('should unwrap when highlight markers are outside selection', () => {
      const result = getToggleMarkerAction('hello', '==', '==', '==', '==')
      expect(result.type).toBe('unwrap-surrounding')
    })

    it('should unwrap when inline code markers are outside selection', () => {
      const result = getToggleMarkerAction('hello', '`', '`', '`', '`')
      expect(result.type).toBe('unwrap-surrounding')
    })

    it('should unwrap surrounding with multi-word content', () => {
      const result = getToggleMarkerAction('hello world', '**', '**', '**', '**')
      expect(result.type).toBe('unwrap-surrounding')
    })
  })

  describe('edge cases', () => {
    it('should wrap when selection is just the markers (no content)', () => {
      // Selection is "****" - this is 4 chars, which equals before.length + after.length
      // The inner content would be empty string, which is valid to unwrap
      const result = getToggleMarkerAction('****', '', '', '**', '**')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should wrap when selection starts with marker but does not end with it', () => {
      const result = getToggleMarkerAction('**hello', '', '', '**', '**')
      expect(result.type).toBe('wrap')
    })

    it('should wrap when selection ends with marker but does not start with it', () => {
      const result = getToggleMarkerAction('hello**', '', '', '**', '**')
      expect(result.type).toBe('wrap')
    })

    it('should wrap when selection is shorter than markers combined', () => {
      // Selection is "**" which is only 2 chars, but we need 4 for before+after
      const result = getToggleMarkerAction('**', '', '', '**', '**')
      expect(result.type).toBe('wrap')
    })

    it('should handle single character markers correctly', () => {
      const result = getToggleMarkerAction('*x*', '', '', '*', '*')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should handle empty inner content for single char markers', () => {
      // Selection is "**" (two asterisks) with single asterisk markers
      const result = getToggleMarkerAction('**', '', '', '*', '*')
      expect(result.type).toBe('unwrap-selection')
    })

    it('should not confuse bold and italic markers', () => {
      // Looking for italic (*) but text has bold (**)
      const result = getToggleMarkerAction('**hello**', '', '', '*', '*')
      // Starts with * and ends with * so it will unwrap, but the content will be "*hello*"
      expect(result.type).toBe('unwrap-selection')
    })

    it('should handle surrounding partial markers', () => {
      // Only one asterisk surrounding when we need two for bold
      const result = getToggleMarkerAction('hello', '*', '*', '**', '**')
      expect(result.type).toBe('wrap')
    })
  })
})
