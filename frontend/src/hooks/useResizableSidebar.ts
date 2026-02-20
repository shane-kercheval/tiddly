/**
 * Shared drag-to-resize logic for right sidebar panels.
 * Handles width constraints, drag state, responsive breakpoint, and window resize.
 */
import { useState, useEffect, useCallback } from 'react'
import { useRightSidebarStore, MIN_SIDEBAR_WIDTH, MIN_CONTENT_WIDTH } from '../stores/rightSidebarStore'

const MD_BREAKPOINT = 768

function calculateMaxWidth(): number {
  const leftSidebar = document.getElementById('desktop-sidebar')
  const leftSidebarWidth = leftSidebar?.getBoundingClientRect().width ?? 0
  return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - leftSidebarWidth - MIN_CONTENT_WIDTH)
}

interface ResizableSidebarResult {
  width: number
  isDesktop: boolean
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent) => void
}

export function useResizableSidebar(): ResizableSidebarResult {
  const storeWidth = useRightSidebarStore((state) => state.width)
  const setWidth = useRightSidebarStore((state) => state.setWidth)
  const [isDragging, setIsDragging] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= MD_BREAKPOINT : true
  )

  // Constrain width to current viewport on mount and window resize
  useEffect(() => {
    const constrainWidth = (): void => {
      const maxWidth = calculateMaxWidth()
      if (storeWidth > maxWidth) {
        setWidth(maxWidth)
      }
      setIsDesktop(window.innerWidth >= MD_BREAKPOINT)
    }
    constrainWidth()
    window.addEventListener('resize', constrainWidth)
    return () => window.removeEventListener('resize', constrainWidth)
  }, [storeWidth, setWidth])

  const width = isDesktop ? Math.min(storeWidth, calculateMaxWidth()) : storeWidth

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent): void => {
      const newWidth = window.innerWidth - e.clientX
      const maxWidth = calculateMaxWidth()
      setWidth(Math.min(newWidth, maxWidth))
    }

    const handleMouseUp = (): void => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging, setWidth])

  return { width, isDesktop, isDragging, handleMouseDown }
}
