/**
 * Portal-based dropdown container.
 *
 * Renders children via React portal on document.body, positioned relative
 * to an anchor element using `position: fixed`. This allows dropdowns to
 * escape overflow:hidden/auto containers (e.g. scrollable content areas).
 *
 * Repositions on scroll and resize to stay aligned with the anchor.
 * Exposes a ref to its container so parent click-outside handlers can
 * treat portal content as "inside" the component.
 */
import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode, Ref, CSSProperties } from 'react'

interface DropdownPortalProps {
  /** Ref to the element the dropdown is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Dropdown content. */
  children: ReactNode
  /** Whether the dropdown is visible. */
  open: boolean
}

/** Handle exposed via ref — lets parents check if a click is inside the portal. */
export interface DropdownPortalHandle {
  contains: (target: Node) => boolean
}

/** Height estimate for flipping logic (max-h-48 = 192px + buffer). */
const DROPDOWN_HEIGHT_ESTIMATE = 220

export const DropdownPortal = forwardRef(function DropdownPortal(
  { anchorRef, children, open }: DropdownPortalProps,
  ref: Ref<DropdownPortalHandle>,
): ReactNode {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    contains: (target: Node) => portalRef.current?.contains(target) ?? false,
  }), [])

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const openUpward = spaceBelow < DROPDOWN_HEIGHT_ESTIMATE

    if (openUpward) {
      setStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top,
        left: rect.left,
        minWidth: rect.width,
        zIndex: 50,
      })
    } else {
      setStyle({
        position: 'fixed',
        top: rect.bottom,
        left: rect.left,
        minWidth: rect.width,
        zIndex: 50,
      })
    }
  }, [anchorRef])

  useEffect(() => {
    if (!open) {
      setStyle(null)
      return
    }

    updatePosition()

    // Capture phase catches scrolls on any ancestor container
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  if (!open || !style) return null

  return createPortal(
    <div ref={portalRef} style={style}>{children}</div>,
    document.body,
  )
})
