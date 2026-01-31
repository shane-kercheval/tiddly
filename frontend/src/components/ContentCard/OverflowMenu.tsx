/**
 * Overflow menu for card actions on mobile/touch devices.
 *
 * Shows a "•••" button that opens a dropdown with action items.
 * Used instead of hover-revealed actions on touch devices.
 */
import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { MoreIcon } from '../icons'

interface OverflowMenuItem {
  /** Unique key for the item */
  key: string
  /** Label to display */
  label: string
  /** Icon to show before the label */
  icon: ReactNode
  /** Click handler */
  onClick: () => void
  /** Whether this is a destructive action (shown in red) */
  danger?: boolean
  /** Whether the item is disabled */
  disabled?: boolean
}

interface OverflowMenuProps {
  /** Menu items to display */
  items: OverflowMenuItem[]
  /** Additional CSS classes for the trigger button */
  className?: string
}

export function OverflowMenu({ items, className = '' }: OverflowMenuProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  const handleItemClick = (item: OverflowMenuItem): void => {
    if (item.disabled) return
    setIsOpen(false)
    item.onClick()
  }

  const visibleItems = items.filter(item => !item.disabled || item.disabled === false)

  if (visibleItems.length === 0) return null

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        className={`btn-icon ${className}`}
        aria-label="More actions"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <MoreIcon className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          role="menu"
        >
          {visibleItems.map((item) => (
            <button
              key={item.key}
              onClick={(e) => {
                e.stopPropagation()
                handleItemClick(item)
              }}
              disabled={item.disabled}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
              } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              role="menuitem"
            >
              <span className="h-4 w-4 shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
