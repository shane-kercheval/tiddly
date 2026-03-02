import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Collapsible FAQ accordion item with chevron toggle.
 * Used on landing page and pricing page.
 */
export function FAQItem({
  question,
  defaultOpen = false,
  id,
  children,
}: {
  question: string
  defaultOpen?: boolean
  id?: string
  children: ReactNode
}): ReactNode {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div id={id} className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-5 text-left transition-colors hover:text-gray-600"
        aria-expanded={isOpen}
      >
        <h3 className="pr-4 text-lg font-semibold text-gray-900">{question}</h3>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          isOpen ? 'max-h-[1000px] opacity-100 pb-5' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-3 text-[15px] leading-relaxed text-gray-500">
          {children}
        </div>
      </div>
    </div>
  )
}
