import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { AISetupWidget } from '../../components/AISetupWidget'
import { ExamplePrompts } from './components/ExamplePrompts'

export function DocsAIHub(): ReactNode {
  usePageTitle('Docs - AI Integration')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">AI Integration</h1>

      <AISetupWidget />

      <ExamplePrompts />
    </div>
  )
}
