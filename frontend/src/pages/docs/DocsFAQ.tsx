/**
 * Docs page for Frequently Asked Questions.
 *
 * Renders shared FAQContent with docs-specific page title and heading.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { FAQContent } from '../../components/FAQContent'

export function DocsFAQ(): ReactNode {
  usePageTitle('Docs - FAQ')
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">FAQ</h1>
      <p className="text-sm text-gray-600 mb-8">
        Answers to common questions about how things work.
      </p>

      <FAQContent />
    </div>
  )
}
