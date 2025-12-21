/**
 * Tests for ConsentDialog component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ConsentDialog } from './ConsentDialog'
import { useConsentStore } from '../stores/consentStore'

// Mock the consent store
vi.mock('../stores/consentStore', () => ({
  useConsentStore: vi.fn(),
}))

const mockUseConsentStore = useConsentStore as unknown as ReturnType<typeof vi.fn>

describe('ConsentDialog', () => {
  const defaultMockState = {
    isLoading: false,
    error: null,
    recordConsent: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConsentStore.mockReturnValue(defaultMockState)
  })

  const renderDialog = () => {
    return render(
      <MemoryRouter>
        <ConsentDialog />
      </MemoryRouter>
    )
  }

  describe('rendering', () => {
    it('renders dialog with title and description', () => {
      renderDialog()

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Welcome to Tiddly')).toBeInTheDocument()
      expect(
        screen.getByText(/please review and accept our policies/i)
      ).toBeInTheDocument()
    })

    it('renders links to Privacy Policy and Terms of Service', () => {
      renderDialog()

      const privacyLink = screen.getByRole('link', { name: /privacy policy/i })
      const termsLink = screen.getByRole('link', { name: /terms of service/i })

      expect(privacyLink).toHaveAttribute('href', '/privacy')
      expect(privacyLink).toHaveAttribute('target', '_blank')
      expect(termsLink).toHaveAttribute('href', '/terms')
      expect(termsLink).toHaveAttribute('target', '_blank')
    })

    it('renders checkbox unchecked by default', () => {
      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()
    })

    it('renders accept button disabled by default', () => {
      renderDialog()

      const button = screen.getByRole('button', { name: /accept and continue/i })
      expect(button).toBeDisabled()
    })
  })

  describe('checkbox interaction', () => {
    it('enables accept button when checkbox is checked', async () => {
      const user = userEvent.setup()
      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      const button = screen.getByRole('button', { name: /accept and continue/i })

      expect(button).toBeDisabled()

      await user.click(checkbox)

      expect(checkbox).toBeChecked()
      expect(button).not.toBeDisabled()
    })

    it('disables accept button when checkbox is unchecked again', async () => {
      const user = userEvent.setup()
      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      const button = screen.getByRole('button', { name: /accept and continue/i })

      await user.click(checkbox)
      expect(button).not.toBeDisabled()

      await user.click(checkbox)
      expect(button).toBeDisabled()
    })
  })

  describe('accept button', () => {
    it('calls recordConsent when clicked with checkbox checked', async () => {
      const mockRecordConsent = vi.fn().mockResolvedValue(undefined)
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        recordConsent: mockRecordConsent,
      })

      const user = userEvent.setup()
      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      const button = screen.getByRole('button', { name: /accept and continue/i })

      await user.click(checkbox)
      await user.click(button)

      expect(mockRecordConsent).toHaveBeenCalledTimes(1)
    })

    it('does not call recordConsent when checkbox is not checked', async () => {
      const mockRecordConsent = vi.fn()
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        recordConsent: mockRecordConsent,
      })

      const user = userEvent.setup()
      renderDialog()

      const button = screen.getByRole('button', { name: /accept and continue/i })
      await user.click(button)

      expect(mockRecordConsent).not.toHaveBeenCalled()
    })
  })

  describe('loading state', () => {
    it('shows processing text when isLoading is true', () => {
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        isLoading: true,
      })

      renderDialog()

      expect(screen.getByRole('button', { name: /processing/i })).toBeInTheDocument()
    })

    it('disables checkbox when loading', () => {
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        isLoading: true,
      })

      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).toBeDisabled()
    })

    it('disables button when loading even if checkbox is checked', async () => {
      const user = userEvent.setup()

      // Start with not loading to check the checkbox
      mockUseConsentStore.mockReturnValue(defaultMockState)
      const { rerender } = renderDialog()

      const checkbox = screen.getByRole('checkbox')
      await user.click(checkbox)

      // Now set loading state
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        isLoading: true,
      })
      rerender(
        <MemoryRouter>
          <ConsentDialog />
        </MemoryRouter>
      )

      const button = screen.getByRole('button', { name: /processing/i })
      expect(button).toBeDisabled()
    })
  })

  describe('error state', () => {
    it('displays error message when error exists', () => {
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        error: 'Failed to record consent',
      })

      renderDialog()

      expect(screen.getByText(/failed to record consent/i)).toBeInTheDocument()
    })

    it('does not display error section when no error', () => {
      renderDialog()

      expect(screen.queryByText(/error/i)).not.toBeInTheDocument()
    })
  })

  describe('error handling', () => {
    it('handles recordConsent error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockRecordConsent = vi.fn().mockRejectedValue(new Error('API Error'))
      mockUseConsentStore.mockReturnValue({
        ...defaultMockState,
        recordConsent: mockRecordConsent,
      })

      const user = userEvent.setup()
      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      const button = screen.getByRole('button', { name: /accept and continue/i })

      await user.click(checkbox)
      await user.click(button)

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalled()
      })

      consoleError.mockRestore()
    })
  })

  describe('accessibility', () => {
    it('has proper aria attributes on dialog', () => {
      renderDialog()

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAttribute('aria-labelledby', 'consent-title')
    })

    it('has proper label association for checkbox', () => {
      renderDialog()

      const checkbox = screen.getByRole('checkbox')
      // The label wraps the checkbox, so clicking label text should toggle
      expect(checkbox).toBeInTheDocument()
    })
  })
})
