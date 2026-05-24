/**
 * Shared FAQ content used by both Settings → FAQ and Docs → FAQ.
 *
 * FAQ sections and items are authored as markdown in `src/content/data/faq.json`
 * and rendered through the shared `DocsMarkdown` renderer. Page wrappers
 * (SettingsFAQ, DocsFAQ) handle page title, heading, and layout differences.
 */
import type { ReactNode } from 'react'
import { DocsSection } from '../pages/docs/components/DocsSection'
import { DocsMarkdown } from './markdown/DocsMarkdown'
import { FAQ_SECTIONS } from '../content/data/faq'

interface FAQItemProps {
  question: string
  answer: string
}

function FAQItem({ question, answer }: FAQItemProps): ReactNode {
  return (
    <div className="border-b border-gray-100 py-5 last:border-b-0">
      <h3 className="text-base font-medium text-gray-900 mb-2">{question}</h3>
      <div className="text-sm text-gray-600 space-y-2">
        <DocsMarkdown body={answer} />
      </div>
    </div>
  )
}

export function FAQContent(): ReactNode {
  return (
    <>
      {FAQ_SECTIONS.map((section) => (
        <DocsSection key={section.section} title={section.section}>
          {section.items.map((item) => (
            <FAQItem key={item.question} question={item.question} answer={item.answer} />
          ))}
        </DocsSection>
      ))}
    </>
  )
}
