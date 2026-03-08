/**
 * Settings page for MCP (Model Context Protocol) and Skills setup instructions.
 * Wraps the shared AISetupWidget with page title and heading.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { AISetupWidget } from '../../components/AISetupWidget'

/**
 * MCP & Skills setup instructions settings page.
 */
export function SettingsMCP(): ReactNode {
  usePageTitle('Settings - MCP')

  return (
    <div className="max-w-3xl pt-3">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">AI Integration</h1>
      </div>

      <AISetupWidget />
    </div>
  )
}
