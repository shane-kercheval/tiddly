/**
 * Settings page for Frequently Asked Questions.
 *
 * Renders shared FAQContent with settings-specific page title and heading.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { FAQContent } from '../../components/FAQContent'

/**
 * FAQ settings page.
 */
export function SettingsFAQ(): ReactNode {
  usePageTitle('Settings - FAQ')
  return (
    <div className="max-w-3xl pt-3">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">FAQ</h1>
        <p className="mt-1 text-sm text-gray-500">
          Answers to common questions about how things work.
        </p>
      </div>

      <FAQContent />
    </div>
  )
}
