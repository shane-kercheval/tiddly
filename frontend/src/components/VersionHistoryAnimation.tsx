import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useAnimation, useInView, AnimatePresence } from 'motion/react'
import { Cursor, delay, typeText } from './animationUtils'

const BASE_LINE1 = 'The authentication endpoint uses OAuth 2.0 with refresh tokens.'
const TYPED_ADDITION = ' Tokens expire after 30 days.'
const LINE2 = 'Rate limiting is set to 200 requests per minute per user.'

const DIFF_LINES = [
  { type: 'context', text: '  ...OAuth 2.0 with refresh tokens.' },
  { type: 'added', text: '+ Tokens expire after 30 days.', highlights: ['Tokens expire after 30 days.'] },
  { type: 'context', text: '  Rate limiting is set to 200...' },
] as const

function highlightWords(text: string, highlights: readonly string[]): ReactNode {
  let remaining = text
  const parts: ReactNode[] = []
  let key = 0

  for (const word of highlights) {
    const idx = remaining.indexOf(word)
    if (idx === -1) continue
    if (idx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>)
    }
    parts.push(<span key={key++} className="rounded-sm bg-green-200 px-0.5">{word}</span>)
    remaining = remaining.slice(idx + word.length)
  }
  if (remaining) {
    parts.push(<span key={key++}>{remaining}</span>)
  }
  return <>{parts}</>
}

function NoteMockup({
  typedAddition,
  showCursor,
  typingDone,
  showMCPBadge,
}: {
  typedAddition: string
  showCursor: boolean
  typingDone: boolean
  showMCPBadge: boolean
}): ReactNode {
  return (
    <div className="h-[180px] w-96 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar — fixed h-9 so MCP badge doesn't shift height */}
      <div className="flex h-9 items-center gap-2 border-b border-gray-100 px-4">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
        </div>
        <span className="ml-1 text-xs font-medium text-gray-500">Tiddly</span>
        <AnimatePresence>
          {showMCPBadge && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600"
            >
              Updated via MCP
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {/* Body */}
      <div className="p-4">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">Note</div>
        <div className="mb-3 text-sm font-semibold text-gray-800">API Design Notes</div>
        <div className="text-xs leading-relaxed text-gray-600">
          <div>
            {BASE_LINE1}
            {typedAddition && (
              <span className={`transition-colors duration-500 ${typingDone ? 'text-gray-600' : 'text-blue-500'}`}>
                {typedAddition}
              </span>
            )}
            {showCursor && <Cursor />}
          </div>
          <div>{LINE2}</div>
        </div>
      </div>
    </div>
  )
}

function VersionHistoryMockup({
  v2Label,
  showV3,
  selectedVersion,
  showDiff,
}: {
  v2Label: string
  showV3: boolean
  selectedVersion: number | null
  showDiff: boolean
}): ReactNode {
  return (
    <div className="h-[260px] w-72 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex h-9 items-center gap-2 border-b border-gray-100 px-4">
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs font-medium text-gray-500">Version History</span>
      </div>
      {/* Version entries */}
      <div className="divide-y divide-gray-100">
        {/* v3 — slides in as new Current */}
        <AnimatePresence>
          {showV3 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className={`px-3 py-2 transition-colors ${selectedVersion === 3 ? 'bg-blue-50' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400" />
                  <span className="text-sm font-medium text-gray-900">Current</span>
                  <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">MCP</span>
                </div>
                <div className="ml-[18px] mt-0.5 text-[10px] text-gray-400">Just now</div>
              </div>
              {/* Diff block */}
              <AnimatePresence>
                {showDiff && selectedVersion === 3 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden border-t border-gray-200 bg-gray-50"
                  >
                    <div className="p-2">
                      {DIFF_LINES.map((line, i) => {
                        const base = 'font-mono text-[11px] leading-relaxed px-1.5 py-px rounded-sm'
                        if (line.type === 'context') {
                          return <div key={i} className={`${base} text-gray-400`}>{line.text}</div>
                        }
                        return (
                          <div key={i} className={`${base} bg-green-50 text-green-900`}>
                            {highlightWords(line.text, line.highlights)}
                          </div>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        {/* v2 — starts as Current, becomes v2 */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400" />
            <span className="text-sm font-medium text-gray-900">{v2Label}</span>
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Web</span>
          </div>
          <div className="ml-[18px] mt-0.5 text-[10px] text-gray-400">5 min ago</div>
        </div>
        {/* v1 */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="text-sm font-medium text-gray-900">v1</span>
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Web</span>
          </div>
          <div className="ml-[18px] mt-0.5 text-[10px] text-gray-400">2 hours ago</div>
        </div>
      </div>
    </div>
  )
}

export function VersionHistoryAnimation({ onComplete }: { onComplete?: () => void } = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, margin: '-40px' })
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  // Note state
  const [typedAddition, setTypedAddition] = useState('')
  const [showCursor, setShowCursor] = useState(false)
  const [typingDone, setTypingDone] = useState(false)
  const [showMCPBadge, setShowMCPBadge] = useState(false)

  // History panel state
  const [v2Label, setV2Label] = useState('Current')
  const [showV3, setShowV3] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [showDiff, setShowDiff] = useState(false)

  const controls = useAnimation()

  useEffect(() => {
    if (!isInView) return

    const active = { current: true }

    async function playSequence(): Promise<void> {
      // 1. Both panels fade in together (note already has content, history has v2+v1)
      await controls.start({
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return
      await delay(800)
      if (!active.current) return

      // 2. Typing animation — addition appears in blue
      setShowCursor(true)
      await typeText(setTypedAddition, TYPED_ADDITION, 30, active)
      if (!active.current) return
      setShowCursor(false)
      await delay(300)
      if (!active.current) return

      // 3. MCP badge appears, blue text fades to normal
      setShowMCPBadge(true)
      setTypingDone(true)
      await delay(600)
      if (!active.current) return

      // 4. New version slides into history, v2 relabels
      setV2Label('v2')
      setShowV3(true)
      await delay(600)
      if (!active.current) return

      // 5. v3 highlights, diff expands
      setSelectedVersion(3)
      await delay(300)
      if (!active.current) return
      setShowDiff(true)
      await delay(2500)
      if (!active.current) return

      // 6. Diff collapses
      setShowDiff(false)
      setSelectedVersion(null)
      await delay(800)
      if (!active.current) return

      // 7. Hold then complete
      await delay(1000)
      if (!active.current) return
      onCompleteRef.current?.()
    }

    playSequence()

    return () => { active.current = false }
  }, [isInView, controls])

  return (
    <div ref={containerRef}>
      <div className="mx-auto max-w-4xl px-6 py-6 sm:px-8">
        <motion.div
          className="flex flex-col items-center justify-center gap-4 lg:flex-row lg:items-start lg:gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={controls}
        >
          {/* Note mockup */}
          <NoteMockup
            typedAddition={typedAddition}
            showCursor={showCursor}
            typingDone={typingDone}
            showMCPBadge={showMCPBadge}
          />

          {/* Version History panel */}
          <VersionHistoryMockup
            v2Label={v2Label}
            showV3={showV3}
            selectedVersion={selectedVersion}
            showDiff={showDiff}
          />
        </motion.div>
      </div>
    </div>
  )
}
