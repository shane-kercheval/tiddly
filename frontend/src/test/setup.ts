import '@testing-library/jest-dom'
import { vi } from 'vitest'
import type { ReactNode } from 'react'
import { createElement } from 'react'

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ([] as unknown as DOMRectList)
}

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

// jsdom doesn't implement ResizeObserver (used to track left-sidebar width changes)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

// Mock react-diff-viewer-continued to avoid ESM module resolution issues in tests
vi.mock('react-diff-viewer-continued', () => ({
  default: ({ oldValue, newValue }: { oldValue: string; newValue: string }) =>
    createElement('div', { 'data-testid': 'diff-viewer' }, `Diff: ${oldValue.length} -> ${newValue.length} chars`),
  DiffMethod: {
    CHARS: 'diffChars',
    WORDS: 'diffWords',
    LINES: 'diffLines',
    SENTENCES: 'diffSentences',
    CSS: 'diffCss',
  },
}))

// Global mock for useLimits hook - provides default tier limits for all tests
vi.mock('../hooks/useLimits', () => ({
  useLimits: () => ({
    limits: {
      tier: 'free',
      max_bookmarks: 1000,
      max_notes: 1000,
      max_prompts: 100,
      max_title_length: 500,
      max_description_length: 1000,
      max_tag_name_length: 50,
      max_bookmark_content_length: 512000,
      max_note_content_length: 500000,
      max_prompt_content_length: 100000,
      max_url_length: 2000,
      max_prompt_name_length: 100,
      max_argument_name_length: 100,
      max_argument_description_length: 1000,
    },
    isLoading: false,
    error: null,
  }),
  limitsKeys: {
    all: ['user-limits'],
    user: (userId: string) => ['user-limits', userId],
  },
}))

// Global mock for useAuthStatus hook - provides default auth status for all tests
vi.mock('../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isLoading: false,
    error: null,
    userId: 'test-user-id',
    userEmail: 'test-user@example.com',
  }),
  AuthStatusContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
  },
}))

// Global mock for useAuthActions hook - no-op actions; tests exercising login/
// logout behavior override this per file.
vi.mock('../hooks/useAuthActions', () => ({
  useAuthActions: () => ({
    login: () => {},
    logout: () => {},
  }),
  AuthActionsContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
  },
}))
