import '@testing-library/jest-dom'
import { vi } from 'vitest'
import type { ReactNode } from 'react'

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ([] as unknown as DOMRectList)
}

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
      max_argument_description_length: 500,
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
  }),
  AuthStatusContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
  },
}))
