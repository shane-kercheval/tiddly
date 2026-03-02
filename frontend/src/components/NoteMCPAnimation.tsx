import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useAnimation, useInView } from 'motion/react'

const ROUGH_NOTE = `- rev grew 18% yoy
- need to hire 2 engs
- launch date tbd, prob march`

const CLEAN_NOTE = `- Revenue grew 18% year-over-year
- Hiring plan: 2 engineers in Q2
- Target launch: March 15`

const USER_PROMPT = 'Clean up my meeting notes'

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

function TiddlyNoteMockup({
  showContent,
  noteText,
  showNoteCursor,
  showCleanNote,
}: {
  showContent: boolean
  noteText: string
  showNoteCursor: boolean
  showCleanNote: boolean
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
        {/* Editor area */}
        <div className="flex-1 p-4">
          {showContent && (
            <>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                Note
              </div>
              <div className="mb-3 text-sm font-semibold text-gray-800">
                Meeting Notes
              </div>
              <div className="relative font-mono text-xs leading-relaxed text-gray-600">
                {/* Rough note */}
                <motion.div
                  animate={{ opacity: showCleanNote ? 0 : 1 }}
                  transition={{ duration: 0.4 }}
                  className={showCleanNote ? 'absolute inset-0' : ''}
                >
                  {noteText.split('\n').map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                  {showNoteCursor && <Cursor />}
                </motion.div>
                {/* Clean note */}
                {showCleanNote && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                  >
                    {CLEAN_NOTE.split('\n').map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </motion.div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ClaudeDesktopMockup({
  chatInputText,
  showInputCursor,
  showUserMessage,
  visibleMessages,
}: {
  chatInputText: string
  showInputCursor: boolean
  showUserMessage: boolean
  visibleMessages: number
}): ReactNode {
  const assistantMessages = [
    { text: 'Reading your notes...', color: 'text-gray-500' },
    { text: 'Cleaning up formatting...', color: 'text-gray-500' },
    { text: 'Note updated \u2713', color: 'text-green-600' },
  ]

  return (
    <div className="mx-auto w-96 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-xs font-medium text-gray-500">Claude Desktop</span>
      </div>
      {/* Chat area + input */}
      <div className="flex min-h-[240px] flex-col">
        {/* Messages */}
        <div className="flex-1 space-y-2.5 p-4">
          {/* User message (right-aligned) */}
          {showUserMessage && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex justify-end"
            >
              <div className="rounded-2xl rounded-br-md bg-blue-500 px-3 py-1.5 text-xs text-white">
                {USER_PROMPT}
              </div>
            </motion.div>
          )}
          {/* Assistant messages (left-aligned) */}
          {assistantMessages.slice(0, visibleMessages).map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className={`inline-block rounded-2xl rounded-bl-md bg-gray-100 px-3 py-1.5 text-xs ${msg.color}`}>
                {msg.text}
              </div>
            </motion.div>
          ))}
        </div>
        {/* Input bar */}
        <div className="border-t border-gray-100 px-3 py-2">
          <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-2.5 py-1.5">
            <div className="flex-1 text-xs text-gray-500">
              {chatInputText}
              {showInputCursor && <Cursor />}
              {!chatInputText && !showInputCursor && (
                <span className="text-gray-300">Message Claude...</span>
              )}
            </div>
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

export function NoteMCPAnimation({ onComplete }: { onComplete?: () => void } = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, margin: '-40px' })

  // Tiddly note state
  const [showContent, setShowContent] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [showNoteCursor, setShowNoteCursor] = useState(false)
  const [showCleanNote, setShowCleanNote] = useState(false)

  // Claude Desktop state
  const [chatInputText, setChatInputText] = useState('')
  const [showInputCursor, setShowInputCursor] = useState(false)
  const [showUserMessage, setShowUserMessage] = useState(false)
  const [visibleMessages, setVisibleMessages] = useState(0)

  const tiddlyControls = useAnimation()
  const readLineControls = useAnimation()
  const updateLineControls = useAnimation()
  const claudeControls = useAnimation()

  useEffect(() => {
    if (!isInView) return

    const active = { current: true }

    async function playSequence(): Promise<void> {
      // === TIDDLY SIDE ===

      // App fades in
      await tiddlyControls.start({
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return

      // Show content area, type rough note
      setShowContent(true)
      await delay(500)
      if (!active.current) return

      setShowNoteCursor(true)
      await typeText(setNoteText, ROUGH_NOTE, 18, active)
      if (!active.current) return
      setShowNoteCursor(false)
      await delay(300)
      if (!active.current) return

      // === CLAUDE SIDE ===

      // Claude Desktop fades in (with input bar visible)
      await claudeControls.start({
        opacity: 1, x: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return
      await delay(300)
      if (!active.current) return

      // User types in the input bar
      setShowInputCursor(true)
      await typeText(setChatInputText, USER_PROMPT, 30, active)
      if (!active.current) return
      setShowInputCursor(false)
      await delay(300)
      if (!active.current) return

      // Input sends — becomes a user message bubble, input clears
      setChatInputText('')
      setShowUserMessage(true)
      await delay(400)
      if (!active.current) return

      // === READ ARROW ===

      await readLineControls.start({
        pathLength: 1, opacity: 1,
        transition: { duration: 0.6, ease: 'easeInOut' },
      })
      if (!active.current) return

      // Assistant messages appear
      await delay(200)
      if (!active.current) return

      setVisibleMessages(1)
      await delay(800)
      if (!active.current) return

      setVisibleMessages(2)
      await delay(800)
      if (!active.current) return

      // === UPDATE ARROW ===

      await updateLineControls.start({
        pathLength: 1, opacity: 1,
        transition: { duration: 0.6, ease: 'easeInOut' },
      })
      if (!active.current) return

      // === NOTE UPDATES ===

      await delay(200)
      if (!active.current) return
      setShowCleanNote(true)
      await delay(400)
      if (!active.current) return

      setVisibleMessages(3)
      await delay(1500)
      if (!active.current) return
      onComplete?.()
    }

    playSequence()

    return () => { active.current = false }
  }, [isInView, tiddlyControls, readLineControls, updateLineControls, claudeControls, onComplete])

  return (
    <div ref={containerRef}>
      <div className="mx-auto max-w-4xl px-6 py-6 sm:px-8">
        <div className="flex flex-col items-stretch justify-center gap-2 lg:flex-row lg:items-center lg:gap-0">
          {/* Tiddly note editor */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={tiddlyControls}
          >
            <TiddlyNoteMockup
              showContent={showContent}
              noteText={noteText}
              showNoteCursor={showNoteCursor}
              showCleanNote={showCleanNote}
            />
          </motion.div>

          {/* Connection lines — horizontal (desktop) */}
          <div className="relative hidden lg:flex lg:flex-col lg:items-center lg:justify-center" style={{ width: '100px', height: '120px' }}>
            {/* Read arrow (left to right, top) */}
            <svg width="100" height="24" viewBox="0 0 100 24" className="overflow-visible">
              <motion.line
                x1="0" y1="12" x2="88" y2="12"
                stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6 4"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={readLineControls}
              />
              <motion.path
                d="M84 7 L94 12 L84 17"
                fill="none" stroke="#d1d5db" strokeWidth="1.5"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={readLineControls}
              />
            </svg>
            <motion.div
              className="my-1 text-[10px] font-medium tracking-wide text-gray-400"
              initial={{ opacity: 0 }}
              animate={readLineControls}
            >
              read
            </motion.div>
            {/* Update arrow (right to left, bottom) */}
            <svg width="100" height="24" viewBox="0 0 100 24" className="overflow-visible">
              <motion.line
                x1="100" y1="12" x2="12" y2="12"
                stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6 4"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={updateLineControls}
              />
              <motion.path
                d="M16 7 L6 12 L16 17"
                fill="none" stroke="#d1d5db" strokeWidth="1.5"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={updateLineControls}
              />
            </svg>
            <motion.div
              className="mt-1 text-[10px] font-medium tracking-wide text-gray-400"
              initial={{ opacity: 0 }}
              animate={updateLineControls}
            >
              update
            </motion.div>
          </div>

          {/* Connection lines — vertical (mobile) */}
          <div className="relative flex flex-col items-center justify-center lg:hidden" style={{ height: '60px' }}>
            <div className="flex items-center gap-3">
              {/* Read arrow (down) */}
              <div className="relative flex flex-col items-center">
                <svg width="24" height="30" viewBox="0 0 24 30" className="overflow-visible">
                  <motion.line
                    x1="12" y1="0" x2="12" y2="20"
                    stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6 4"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={readLineControls}
                  />
                  <motion.path
                    d="M7 17 L12 27 L17 17"
                    fill="none" stroke="#d1d5db" strokeWidth="1.5"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={readLineControls}
                  />
                </svg>
                <motion.div
                  className="mt-0.5 text-[10px] font-medium tracking-wide text-gray-400"
                  initial={{ opacity: 0 }}
                  animate={readLineControls}
                >
                  read
                </motion.div>
              </div>
              {/* Update arrow (up) */}
              <div className="relative flex flex-col items-center">
                <svg width="24" height="30" viewBox="0 0 24 30" className="overflow-visible">
                  <motion.line
                    x1="12" y1="30" x2="12" y2="10"
                    stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="6 4"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={updateLineControls}
                  />
                  <motion.path
                    d="M7 13 L12 3 L17 13"
                    fill="none" stroke="#d1d5db" strokeWidth="1.5"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={updateLineControls}
                  />
                </svg>
                <motion.div
                  className="mt-0.5 text-[10px] font-medium tracking-wide text-gray-400"
                  initial={{ opacity: 0 }}
                  animate={updateLineControls}
                >
                  update
                </motion.div>
              </div>
            </div>
          </div>

          {/* Claude Desktop */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={claudeControls}
          >
            <ClaudeDesktopMockup
              chatInputText={chatInputText}
              showInputCursor={showInputCursor}
              showUserMessage={showUserMessage}
              visibleMessages={visibleMessages}
            />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
