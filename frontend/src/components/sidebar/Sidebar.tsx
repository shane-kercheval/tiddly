/**
 * Main sidebar component with navigation and user info.
 */
import type { ReactNode } from 'react'
import { useSidebarStore } from '../../stores/sidebarStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getTabRoute } from './routes'
import { SidebarSection } from './SidebarSection'
import { SidebarNavItem } from './SidebarNavItem'
import { SidebarUserSection } from './SidebarUserSection'
import type { SectionName } from '../../types'

function BookmarkIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 text-blue-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
      />
    </svg>
  )
}

function NoteIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 text-amber-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  )
}

function SharedIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5 text-purple-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m-13.5-3v10.5c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.75"
      />
    </svg>
  )
}

function getSectionIcon(sectionName: SectionName): ReactNode {
  switch (sectionName) {
    case 'shared':
      return <SharedIcon />
    case 'bookmarks':
      return <BookmarkIcon />
    case 'notes':
      return <NoteIcon />
  }
}

function getSectionVariant(sectionName: SectionName): 'blue' | 'amber' | 'purple' {
  switch (sectionName) {
    case 'shared':
      return 'purple'
    case 'bookmarks':
      return 'blue'
    case 'notes':
      return 'amber'
  }
}

function SettingsIcon(): ReactNode {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  )
}

function CollapseIcon({ isCollapsed }: { isCollapsed: boolean }): ReactNode {
  return (
    <svg
      className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  )
}

function MenuIcon(): ReactNode {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  )
}

function CloseIcon(): ReactNode {
  return (
    <svg
      className="h-6 w-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}

interface SidebarContentProps {
  isCollapsed: boolean
  onNavClick?: () => void
}

function SidebarContent({ isCollapsed, onNavClick }: SidebarContentProps): ReactNode {
  const { expandedSections, toggleSection, toggleCollapse } = useSidebarStore()
  const computedSections = useSettingsStore((state) => state.computedSections)
  const sectionOrder = useSettingsStore((state) => state.sectionOrder)

  const isSettingsExpanded = expandedSections.includes('settings')

  // Build ordered sections from computed data
  const orderedSections = sectionOrder
    .map((name) => computedSections.find((s) => s.name === name))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)

  return (
    <div className="flex h-full flex-col">
      {/* Navigation Sections */}
      <nav className="flex-1 space-y-1 px-2">
        {orderedSections.map((section) => {
          const isExpanded = expandedSections.includes(section.name)
          const variant = getSectionVariant(section.name)

          return (
            <SidebarSection
              key={section.name}
              title={section.label}
              icon={getSectionIcon(section.name)}
              isExpanded={isExpanded}
              onToggle={() => toggleSection(section.name)}
              isCollapsed={isCollapsed}
              collapsible={section.collapsible}
            >
              {section.items.map((item) => (
                <SidebarNavItem
                  key={item.key}
                  to={getTabRoute(item.key, section.name)}
                  label={item.label}
                  isCollapsed={isCollapsed}
                  onClick={onNavClick}
                  variant={variant}
                />
              ))}
            </SidebarSection>
          )
        })}

        <SidebarSection
          title="Settings"
          icon={<SettingsIcon />}
          isExpanded={isSettingsExpanded}
          onToggle={() => toggleSection('settings')}
          isCollapsed={isCollapsed}
          collapsible={true}
        >
          <SidebarNavItem
            to="/app/settings/general"
            label="General"
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
          <SidebarNavItem
            to="/app/settings/lists"
            label="Lists"
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
          <SidebarNavItem
            to="/app/settings/tags"
            label="Tags"
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
          <SidebarNavItem
            to="/app/settings/tokens"
            label="Personal Access Tokens"
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
          <SidebarNavItem
            to="/app/settings/mcp"
            label="MCP Integration"
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
        </SidebarSection>
      </nav>

      {/* Collapse Toggle (desktop only) */}
      <div className="hidden border-t border-gray-200 px-2 py-2 md:block">
        <button
          onClick={toggleCollapse}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <CollapseIcon isCollapsed={isCollapsed} />
          {!isCollapsed && <span>Collapse</span>}
        </button>
      </div>

      {/* User Section */}
      <div className="border-t border-gray-200 px-2 py-3">
        <SidebarUserSection isCollapsed={isCollapsed} />
      </div>
    </div>
  )
}

export function Sidebar(): ReactNode {
  const { isCollapsed, isMobileOpen, toggleMobile, closeMobile } = useSidebarStore()

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={toggleMobile}
        className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 shadow-md md:hidden"
        aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
      >
        {isMobileOpen ? <CloseIcon /> : <MenuIcon />}
      </button>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform bg-white shadow-lg transition-transform md:hidden ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full pt-16">
          <SidebarContent isCollapsed={false} onNavClick={closeMobile} />
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden h-screen flex-shrink-0 border-r border-gray-200 bg-white transition-all md:block ${
          isCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="h-full py-4">
          <SidebarContent isCollapsed={isCollapsed} />
        </div>
      </aside>
    </>
  )
}
