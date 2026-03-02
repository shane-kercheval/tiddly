import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useAnimation, useInView } from 'motion/react'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function typeText(
  setter: (value: string) => void,
  text: string,
  charDelay: number,
  isMounted: { current: boolean },
): Promise<void> {
  return new Promise(resolve => {
    let i = 0
    const interval = setInterval(() => {
      if (!isMounted.current) { clearInterval(interval); resolve(); return }
      i++
      setter(text.slice(0, i))
      if (i >= text.length) { clearInterval(interval); resolve() }
    }, charDelay)
  })
}

function Cursor(): ReactNode {
  return (
    <motion.span
      className="ml-px inline-block w-[1.5px] bg-gray-800"
      style={{ height: '1em', verticalAlign: 'text-bottom' }}
      animate={{ opacity: [1, 0] }}
      transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
    />
  )
}

function MouseCursor(): ReactNode {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
      <path
        d="M1.5 1L1.5 14.5L5.5 10.5L9 18L11 17L7.5 9.5L12.5 9.5L1.5 1Z"
        fill="black"
        stroke="white"
        strokeWidth="0.8"
      />
    </svg>
  )
}

const EXISTING_BOOKMARKS = [
  { title: 'React Documentation', url: 'react.dev' },
  { title: 'TypeScript Handbook', url: 'typescriptlang.org' },
]

function BrowserMockup({
  urlText,
  showUrlCursor,
  showPage,
  showClickRing,
}: {
  urlText: string
  showUrlCursor: boolean
  showPage: boolean
  showClickRing: boolean
}): ReactNode {
  return (
    <div className="mx-auto w-96 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
        </div>
      </div>
      {/* Address bar + extension icons */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5">
        <div className="flex-1 rounded-md bg-gray-50 px-2.5 py-1 text-[11px] text-gray-500">
          {showPage && (
            <svg className="mr-1 inline-block h-2.5 w-2.5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C9.24 2 7 4.24 7 7v3H6c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2h-1V7c0-2.76-2.24-5-5-5zm3 8H9V7c0-1.66 1.34-3 3-3s3 1.34 3 3v3z" />
            </svg>
          )}
          {urlText}
          {showUrlCursor && <Cursor />}
          {!urlText && !showUrlCursor && (
            <span className="text-gray-300">Search or enter URL</span>
          )}
        </div>
        {/* Extension icons */}
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded bg-gray-100" />
          <div className="relative">
            <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
            </svg>
            {showClickRing && (
              <motion.div
                className="absolute -inset-2 rounded-full border-2 border-blue-400"
                initial={{ scale: 0.5, opacity: 1 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 0.4 }}
              />
            )}
          </div>
        </div>
      </div>
      {/* Page content */}
      <div className="min-h-[220px] p-4">
        {showPage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-2 text-sm font-bold text-gray-800">The Python Tutorial</div>
            <div className="mb-3 h-px bg-gray-200" />
            <div className="space-y-2">
              <div className="h-2 w-11/12 rounded bg-gray-100" />
              <div className="h-2 w-9/12 rounded bg-gray-100" />
              <div className="h-2 w-10/12 rounded bg-gray-100" />
              <div className="h-2 w-7/12 rounded bg-gray-100" />
              <div className="mt-4 h-2 w-8/12 rounded bg-gray-100" />
              <div className="h-2 w-11/12 rounded bg-gray-100" />
              <div className="h-2 w-6/12 rounded bg-gray-100" />
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

function ChromeExtensionMockup({
  showForm,
  urlText,
  titleText,
  visibleTags,
  buttonState,
}: {
  showForm: boolean
  urlText: string
  titleText: string
  visibleTags: number
  buttonState: 'idle' | 'saving' | 'saved'
}): ReactNode {
  const tags = ['python', 'docs']

  return (
    <div className="mx-auto w-96 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z" />
          </svg>
          <span className="text-xs font-medium text-gray-500">Chrome Extension</span>
        </div>
        <svg className="h-3.5 w-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {/* Body */}
      <div className="min-h-[240px] p-4">
        {showForm && (
          <div className="space-y-3">
            {/* URL field (readonly) */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                URL
              </div>
              <div className="rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500">
                {urlText}
              </div>
            </div>
            {/* Title field */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                Title
              </div>
              <div className="border-b border-gray-200 pb-1.5 text-sm text-gray-800">
                {titleText || <span className="text-gray-300">page title...</span>}
              </div>
            </div>
            {/* Tags */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                Tags
              </div>
              <div className="flex min-h-[22px] gap-1.5">
                {tags.slice(0, visibleTags).map((tag) => (
                  <motion.span
                    key={tag}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.15 }}
                    className="inline-flex items-center rounded-full bg-blue-50 px-2 py-px text-[10px] font-medium leading-none text-blue-600"
                  >
                    {tag}
                  </motion.span>
                ))}
              </div>
            </div>
            {/* Save button */}
            <div className="pt-1">
              {buttonState === 'idle' && (
                <div className="w-full rounded-lg bg-gray-900 py-2 text-center text-xs font-medium text-white">
                  Save Bookmark
                </div>
              )}
              {buttonState === 'saving' && (
                <motion.div
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                  className="w-full rounded-lg bg-gray-700 py-2 text-center text-xs font-medium text-white"
                >
                  Saving...
                </motion.div>
              )}
              {buttonState === 'saved' && (
                <div className="w-full rounded-lg bg-green-600 py-2 text-center text-xs font-medium text-white">
                  &#10003; Saved
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TiddlyBookmarksMockup({
  showList,
  showNewBookmark,
}: {
  showList: boolean
  showNewBookmark: boolean
}): ReactNode {
  return (
    <div className="mx-auto w-96 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
        </div>
        <span className="ml-1 text-xs font-medium text-gray-500">Tiddly</span>
      </div>
      {/* Body */}
      <div className="flex min-h-[240px]">
        {/* Sidebar hint */}
        <div className="w-14 border-r border-gray-100 bg-gray-50/50 p-2.5">
          <div className="mb-2 h-2 w-7 rounded bg-gray-200" />
          <div className="mb-2 h-2 w-9 rounded bg-gray-200" />
          <div className="h-2 w-5 rounded bg-gray-200" />
        </div>
        {/* Content area */}
        <div className="flex-1 p-4">
          <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-gray-400">
            Bookmarks
          </div>
          {showList && (
            <div className="space-y-2">
              {showNewBookmark && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2"
                >
                  <div className="text-xs font-medium text-gray-700">The Python Tutorial</div>
                  <div className="text-[10px] text-gray-400">docs.python.org</div>
                </motion.div>
              )}
              {EXISTING_BOOKMARKS.map((bm) => (
                <motion.div
                  layout
                  transition={{ layout: { duration: 0.3 } }}
                  key={bm.title}
                  className="rounded-lg border border-gray-100 px-3 py-2"
                >
                  <div className="text-xs font-medium text-gray-700">{bm.title}</div>
                  <div className="text-[10px] text-gray-400">{bm.url}</div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChromeExtensionAnimation({ onComplete }: { onComplete?: () => void } = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, margin: '-40px' })

  // Browser state
  const [showBrowser, setShowBrowser] = useState(true)
  const [browserUrl, setBrowserUrl] = useState('')
  const [showUrlCursor, setShowUrlCursor] = useState(false)
  const [showPage, setShowPage] = useState(false)
  const [showCursor, setShowCursor] = useState(false)
  const [showClickRing, setShowClickRing] = useState(false)

  // Extension popup state (always mounted, starts invisible)
  const [popupDone, setPopupDone] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [extUrlText, setExtUrlText] = useState('')
  const [titleText, setTitleText] = useState('')
  const [visibleTags, setVisibleTags] = useState(0)
  const [buttonState, setButtonState] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Tiddly state
  const [showList, setShowList] = useState(false)
  const [showNewBookmark, setShowNewBookmark] = useState(false)

  const leftControls = useAnimation()
  const browserControls = useAnimation()
  const popupControls = useAnimation()
  const cursorControls = useAnimation()
  const lineControls = useAnimation()
  const tiddlyControls = useAnimation()

  useEffect(() => {
    if (!isInView) return

    const active = { current: true }

    async function playSequence(): Promise<void> {
      // === BROWSER PHASE ===

      // Browser fades in
      await leftControls.start({
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return

      // Type URL in address bar
      await delay(300)
      if (!active.current) return
      setShowUrlCursor(true)
      await typeText(setBrowserUrl, 'docs.python.org/3/tutorial', 30, active)
      if (!active.current) return
      setShowUrlCursor(false)
      await delay(400)
      if (!active.current) return

      // Page loads
      setShowPage(true)
      await delay(700)
      if (!active.current) return

      // Show cursor in page area
      setShowCursor(true)
      await cursorControls.start({
        opacity: 1,
        transition: { duration: 0.2 },
      })
      if (!active.current) return

      // Move cursor to extension icon (top-right of address bar)
      await cursorControls.start({
        left: '85%', top: '14%',
        transition: { duration: 0.8, ease: 'easeInOut' },
      })
      if (!active.current) return

      // Click ring on the extension icon
      setShowClickRing(true)
      await delay(400)
      if (!active.current) return
      setShowClickRing(false)

      // Hide cursor
      await cursorControls.start({
        opacity: 0,
        transition: { duration: 0.15 },
      })
      if (!active.current) return
      setShowCursor(false)

      // === POPUP APPEARS (MINI SCALE) ===

      // Popup is always mounted but invisible — show form and fade in
      setShowForm(true)
      setExtUrlText('docs.python.org/3/tutorial')
      setTitleText('The Python Tutorial')
      // Fade in while keeping at mini scale
      await popupControls.start({
        opacity: 1, scale: 0.35, right: 8, top: 52,
        transition: { duration: 0.2, ease: 'easeOut' },
      })
      if (!active.current) return
      await delay(700)
      if (!active.current) return

      // === SCALE UP (single element, no fade) ===

      // Browser fades out behind; popup scales up smoothly
      browserControls.start({
        opacity: 0, scale: 1.08,
        transition: { duration: 0.5, ease: 'easeIn' },
      })
      await popupControls.start({
        scale: 1, right: 0, top: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return
      setShowBrowser(false)
      setPopupDone(true)

      // === EXTENSION PHASE ===
      await delay(200)
      if (!active.current) return

      // Tags appear one by one
      setVisibleTags(1)
      await delay(200)
      if (!active.current) return
      setVisibleTags(2)
      await delay(400)
      if (!active.current) return

      // Button → saving
      setButtonState('saving')
      await delay(600)
      if (!active.current) return

      // Button → saved
      setButtonState('saved')
      await delay(300)
      if (!active.current) return

      // === TRANSITION (arrow) ===

      await lineControls.start({
        pathLength: 1, opacity: 1,
        transition: { duration: 0.6, ease: 'easeInOut' },
      })
      if (!active.current) return

      // === TIDDLY SIDE ===

      // Tiddly app fades in
      await tiddlyControls.start({
        opacity: 1, x: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return

      // Show existing bookmarks
      setShowList(true)
      await delay(500)
      if (!active.current) return

      // New bookmark slides in at the top
      setShowNewBookmark(true)
      await delay(1500)
      if (!active.current) return
      onComplete?.()
    }

    playSequence()

    return () => { active.current = false }
  }, [isInView, leftControls, browserControls, popupControls, cursorControls, lineControls, tiddlyControls, onComplete])

  return (
    <div ref={containerRef}>
      <div className="mx-auto max-w-4xl px-6 py-6 sm:px-8">
        <div className="flex flex-col items-stretch justify-center gap-4 lg:flex-row lg:items-center lg:gap-0">
          {/* Left: Browser → mini popup → full Extension */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={leftControls}
          >
            <div className="relative">
              {/* Browser mockup — fades/zooms out during transition */}
              {showBrowser && (
                <motion.div
                  initial={{ opacity: 1, scale: 1 }}
                  animate={browserControls}
                  style={{
                    transformOrigin: '90% 15%',
                    ...(popupDone ? { position: 'absolute' as const, top: 0, left: 0, right: 0, zIndex: 1, pointerEvents: 'none' as const } : {}),
                  }}
                >
                  <BrowserMockup
                    urlText={browserUrl}
                    showUrlCursor={showUrlCursor}
                    showPage={showPage}
                    showClickRing={showClickRing}
                  />
                </motion.div>
              )}

              {/* Extension popup — always mounted, starts invisible at mini scale */}
              <motion.div
                style={{
                  transformOrigin: 'top right',
                  ...(popupDone
                    ? {}
                    : { position: 'absolute' as const, zIndex: 20 }),
                }}
                initial={{ scale: 0.35, opacity: 0, right: 8, top: 52 }}
                animate={popupControls}
              >
                <ChromeExtensionMockup
                  showForm={showForm}
                  urlText={extUrlText}
                  titleText={titleText}
                  visibleTags={visibleTags}
                  buttonState={buttonState}
                />
              </motion.div>

              {/* Mouse cursor overlay */}
              {showCursor && (
                <motion.div
                  className="pointer-events-none absolute z-10"
                  initial={{ left: '35%', top: '60%', opacity: 0 }}
                  animate={cursorControls}
                >
                  <MouseCursor />
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* Connection line — horizontal (desktop) */}
          <div className="relative hidden lg:flex lg:items-center" style={{ width: '100px' }}>
            <svg width="100" height="24" viewBox="0 0 100 24" className="overflow-visible">
              <motion.line
                x1="0" y1="12" x2="88" y2="12"
                stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6 4"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={lineControls}
              />
              <motion.path
                d="M84 7 L94 12 L84 17"
                fill="none" stroke="#d1d5db" strokeWidth="1.5"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={lineControls}
              />
            </svg>
            <motion.div
              className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 text-[10px] font-medium tracking-wide text-gray-400"
              initial={{ opacity: 0 }}
              animate={lineControls}
            >
              syncs
            </motion.div>
          </div>

          {/* Connection line — vertical (mobile) */}
          <div className="relative flex flex-col items-center justify-center lg:hidden" style={{ height: '50px' }}>
            <svg width="24" height="50" viewBox="0 0 24 50" className="overflow-visible">
              <motion.line
                x1="12" y1="0" x2="12" y2="38"
                stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6 4"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={lineControls}
              />
              <motion.path
                d="M7 34 L12 44 L17 34"
                fill="none" stroke="#d1d5db" strokeWidth="1.5"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={lineControls}
              />
            </svg>
            <motion.div
              className="mt-1 text-[10px] font-medium tracking-wide text-gray-400"
              initial={{ opacity: 0 }}
              animate={lineControls}
            >
              syncs
            </motion.div>
          </div>

          {/* Tiddly bookmarks list */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={tiddlyControls}
          >
            <TiddlyBookmarksMockup
              showList={showList}
              showNewBookmark={showNewBookmark}
            />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
