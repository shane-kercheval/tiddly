import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useAnimation, useInView } from 'motion/react'

const TEMPLATE_TEXT = 'Review this {{ language }} code:\n\n{{ code }}\n\nFocus on bugs, security,\nand readability.'

const PICKER_ITEMS = ['bug-fix', 'debug-helper', 'code-review']

const RESPONSE_ISSUES = [
  'Missing null check on line 12',
  'Use parameterized queries',
  'Add input validation',
]

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

function animateCount(
  setter: (value: number) => void,
  total: number,
  stepDelay: number,
  isMounted: { current: boolean },
): Promise<void> {
  return new Promise(resolve => {
    let i = 0
    const interval = setInterval(() => {
      if (!isMounted.current) { clearInterval(interval); resolve(); return }
      i++
      setter(i)
      if (i >= total) { clearInterval(interval); resolve() }
    }, stepDelay)
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

function renderTemplateText(text: string): ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g)
  const elements: ReactNode[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue

    if (/^\{\{/.test(part)) {
      elements.push(
        <span key={`v-${i}`} className="rounded bg-amber-50 px-0.5 text-amber-700">
          {part}
        </span>
      )
    } else {
      const lines = part.split('\n')
      for (let j = 0; j < lines.length; j++) {
        if (j > 0) elements.push(<br key={`br-${i}-${j}`} />)
        if (lines[j]) elements.push(<span key={`t-${i}-${j}`}>{lines[j]}</span>)
      }
    }
  }

  return <>{elements}</>
}

function TiddlyAppMockup({
  showForm,
  showPlaceholder,
  titleText,
  showTitleCursor,
  contentCharCount,
}: {
  showForm: boolean
  showPlaceholder: boolean
  titleText: string
  showTitleCursor: boolean
  contentCharCount: number
}): ReactNode {
  const isTypingContent = contentCharCount > 0 && contentCharCount < TEMPLATE_TEXT.length

  return (
    <div className="w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:w-80 lg:w-96">
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
          {showForm && (
            <>
              {/* Title field */}
              <div className="mb-4">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Prompt Name
                </div>
                <div className="border-b border-gray-200 pb-1.5 text-sm font-semibold text-gray-800">
                  {showPlaceholder && !titleText && !showTitleCursor && (
                    <span className="font-normal text-gray-300">prompt name...</span>
                  )}
                  {titleText}
                  {showTitleCursor && <Cursor />}
                </div>
              </div>
              {/* Template content — types in character by character */}
              {contentCharCount > 0 && (
                <div className="font-mono text-xs leading-relaxed text-gray-600">
                  {renderTemplateText(TEMPLATE_TEXT.slice(0, contentCharCount))}
                  {isTypingContent && <Cursor />}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ClaudeCodeMockup({
  commandText,
  showCommandCursor,
  showPicker,
  pickerHighlight,
  responseText,
  showResponseCursor,
  visibleIssues,
}: {
  commandText: string
  showCommandCursor: boolean
  showPicker: boolean
  pickerHighlight: number
  responseText: string
  showResponseCursor: boolean
  visibleIssues: number
}): ReactNode {
  return (
    <div className="w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg sm:w-80 lg:w-96">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <span className="font-mono text-xs text-gray-400">&gt;_</span>
        <span className="text-xs font-medium text-gray-500">Claude Code</span>
      </div>
      {/* Terminal area */}
      <div className="min-h-[240px] p-4 font-mono text-sm">
        {/* Command line */}
        <div className="text-gray-700">
          <span className="text-gray-400">$ </span>
          {commandText}
          {showCommandCursor && <Cursor />}
        </div>

        {/* Prompt picker dropdown */}
        {showPicker && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-2 overflow-hidden rounded-lg border border-gray-200 shadow-md"
          >
            <div className="border-b border-gray-100 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
              Prompts
            </div>
            <div className="py-0.5">
              {PICKER_ITEMS.map((item, i) => (
                <div
                  key={item}
                  className={`px-3 py-1.5 text-xs transition-colors duration-150 ${
                    i === pickerHighlight
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-400'
                  }`}
                >
                  {i === pickerHighlight ? (
                    <><span className="mr-1 text-blue-400">&#9656;</span>{item}</>
                  ) : (
                    <>&nbsp;&nbsp;{item}</>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Agent response */}
        {responseText && (
          <div className="mt-3 text-xs text-gray-400">
            {responseText}
            {showResponseCursor && <Cursor />}
          </div>
        )}
        {visibleIssues > 0 && (
          <div className="mt-2 space-y-1">
            {RESPONSE_ISSUES.slice(0, visibleIssues).map((issue) => (
              <motion.div
                key={issue}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="text-xs text-gray-600"
              >
                <span className="mr-1.5 text-green-600">&#8594;</span>
                {issue}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ProductStoryAnimation(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, margin: '-40px' })

  // Tiddly state
  const [showForm, setShowForm] = useState(false)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [showTiddlyCursor, setShowTiddlyCursor] = useState(false)
  const [tiddlyTitle, setTiddlyTitle] = useState('')
  const [contentCharCount, setContentCharCount] = useState(0)

  // Claude state
  const [claudeCommand, setClaudeCommand] = useState('')
  const [showCommandCursor, setShowCommandCursor] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerHighlight, setPickerHighlight] = useState(0)
  const [responseText, setResponseText] = useState('')
  const [showResponseCursor, setShowResponseCursor] = useState(false)
  const [visibleIssues, setVisibleIssues] = useState(0)

  const appControls = useAnimation()
  const lineControls = useAnimation()
  const claudeControls = useAnimation()

  useEffect(() => {
    if (!isInView) return

    // Per-invocation flag — survives React strict mode's setup/cleanup/setup cycle.
    // Each effect invocation creates its own `active` object. Cleanup invalidates
    // only the current invocation's flag, so the next invocation starts fresh.
    const active = { current: true }

    async function playSequence(): Promise<void> {
      // === TIDDLY SIDE ===

      // App fades in
      await appControls.start({
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return

      // Form appears with placeholder
      setShowForm(true)
      setShowPlaceholder(true)
      await delay(500)
      if (!active.current) return

      // Placeholder out, cursor in
      setShowPlaceholder(false)
      setShowTiddlyCursor(true)
      await delay(300)
      if (!active.current) return

      // Type "code-review"
      await typeText(setTiddlyTitle, 'code-review', 55, active)
      if (!active.current) return
      setShowTiddlyCursor(false)
      await delay(200)
      if (!active.current) return

      // Type template content character by character
      await animateCount(setContentCharCount, TEMPLATE_TEXT.length, 20, active)
      if (!active.current) return
      await delay(500)
      if (!active.current) return

      // === TRANSITION ===

      await lineControls.start({
        pathLength: 1, opacity: 1,
        transition: { duration: 0.6, ease: 'easeInOut' },
      })
      if (!active.current) return

      // === CLAUDE SIDE ===

      // Terminal fades in
      await claudeControls.start({
        opacity: 1, x: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return
      await delay(200)
      if (!active.current) return

      // Type "/"
      setShowCommandCursor(true)
      await typeText(setClaudeCommand, '/', 50, active)
      if (!active.current) return
      setShowCommandCursor(false)
      await delay(100)
      if (!active.current) return

      // Picker: navigate from first item down to code-review
      setShowPicker(true)
      setPickerHighlight(0)
      await delay(500)
      if (!active.current) return
      setPickerHighlight(1)
      await delay(400)
      if (!active.current) return
      setPickerHighlight(2)
      await delay(600)
      if (!active.current) return

      // Select — picker closes, command updates
      setShowPicker(false)
      setClaudeCommand('/code-review')
      await delay(400)
      if (!active.current) return

      // Agent types response
      setShowResponseCursor(true)
      await typeText(setResponseText, 'Analyzing code...', 30, active)
      if (!active.current) return
      setShowResponseCursor(false)
      await delay(400)
      if (!active.current) return

      // Issues stream in one by one
      setVisibleIssues(1)
      await delay(300)
      if (!active.current) return
      setVisibleIssues(2)
      await delay(300)
      if (!active.current) return
      setVisibleIssues(3)
    }

    playSequence()

    return () => { active.current = false }
  }, [isInView, appControls, lineControls, claudeControls])

  return (
    <div ref={containerRef}>
      <div className="mx-auto max-w-4xl px-6 py-6 sm:px-8">
        <div className="flex flex-col items-center justify-center gap-4 lg:flex-row lg:gap-0">
          {/* Tiddly app */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={appControls}
          >
            <TiddlyAppMockup
              showForm={showForm}
              showPlaceholder={showPlaceholder}
              titleText={tiddlyTitle}
              showTitleCursor={showTiddlyCursor}
              contentCharCount={contentCharCount}
            />
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
              MCP
            </motion.div>
          </div>

          {/* Connection line — vertical (tablet) */}
          <div className="relative flex items-center justify-center lg:hidden" style={{ height: '50px' }}>
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
              className="absolute left-full top-1/2 ml-2 -translate-y-1/2 text-[10px] font-medium tracking-wide text-gray-400"
              initial={{ opacity: 0 }}
              animate={lineControls}
            >
              MCP
            </motion.div>
          </div>

          {/* Claude Code terminal */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={claudeControls}
          >
            <ClaudeCodeMockup
              commandText={claudeCommand}
              showCommandCursor={showCommandCursor}
              showPicker={showPicker}
              pickerHighlight={pickerHighlight}
              responseText={responseText}
              showResponseCursor={showResponseCursor}
              visibleIssues={visibleIssues}
            />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
