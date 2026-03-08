import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useAnimation, useInView } from 'motion/react'
import { animateCount, delay, typeText } from './animationUtils'
import { Cursor } from './AnimationCursor'

const TEMPLATE_TEXT = 'Review this {{ language }} code:\n\n{{ code }}\n\nFocus on bugs, security,\nand readability.'

const PICKER_ITEMS = ['bug-fix', 'debug-helper', 'code-review']

const RESPONSE_ISSUES = [
  'Missing null check on line 12',
  'Use parameterized queries',
  'Add input validation',
]

interface CLILine {
  text: string
  type: 'command' | 'success' | 'info'
}

const INITIAL_CLI_LINES: CLILine[] = [
  { type: 'command', text: 'curl -fsSL .../install.sh | sh' },
  { type: 'success', text: '✓ tiddly installed' },
]

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

function TiddlyPanel({
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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <div className="flex gap-1.5">
          <div className="h-2 w-2 rounded-full bg-red-400" />
          <div className="h-2 w-2 rounded-full bg-yellow-400" />
          <div className="h-2 w-2 rounded-full bg-green-400" />
        </div>
        <span className="ml-1 text-[11px] font-medium text-gray-500">Tiddly</span>
      </div>
      {/* Body */}
      <div className="min-h-[200px] p-3">
        {showForm && (
          <>
            <div className="mb-3">
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-gray-400">
                Prompt Name
              </div>
              <div className="border-b border-gray-200 pb-1 text-[11px] font-semibold text-gray-800">
                {showPlaceholder && !titleText && !showTitleCursor && (
                  <span className="font-normal text-gray-300">prompt name...</span>
                )}
                {titleText}
                {showTitleCursor && <Cursor />}
              </div>
            </div>
            {contentCharCount > 0 && (
              <div className="font-mono text-[10px] leading-relaxed text-gray-600">
                {renderTemplateText(TEMPLATE_TEXT.slice(0, contentCharCount))}
                {isTypingContent && <Cursor />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CLITerminalPanel({
  lines,
  currentLine,
  showCursor,
}: {
  lines: CLILine[]
  currentLine: string
  showCursor: boolean
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-900 shadow-lg">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
        <div className="flex gap-1.5">
          <div className="h-2 w-2 rounded-full bg-red-400" />
          <div className="h-2 w-2 rounded-full bg-yellow-400" />
          <div className="h-2 w-2 rounded-full bg-green-400" />
        </div>
        <span className="ml-1 text-[11px] font-medium text-gray-400">Terminal</span>
      </div>
      {/* Terminal body */}
      <div className="min-h-[200px] p-3 font-mono text-[10px] leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === 'command'
                ? 'text-gray-300'
                : line.type === 'success'
                  ? 'text-green-400'
                  : 'text-gray-500'
            }
          >
            {line.type === 'command' ? (
              <><span className="text-gray-500">$ </span>{line.text}</>
            ) : (
              <>&nbsp;&nbsp;{line.text}</>
            )}
          </div>
        ))}
        {(currentLine || showCursor) && (
          <div className="text-gray-300">
            <span className="text-gray-500">$ </span>
            {currentLine}
            {showCursor && <Cursor />}
          </div>
        )}
      </div>
    </div>
  )
}

function ClaudeCodePanel({
  commandText,
  commandConfirmed,
  showCommandCursor,
  showPicker,
  pickerHighlight,
  responseText,
  showResponseCursor,
  visibleIssues,
}: {
  commandText: string
  commandConfirmed: boolean
  showCommandCursor: boolean
  showPicker: boolean
  pickerHighlight: number
  responseText: string
  showResponseCursor: boolean
  visibleIssues: number
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <span className="font-mono text-[11px] text-gray-400">&gt;_</span>
        <span className="text-[11px] font-medium text-gray-500">Claude Code</span>
      </div>
      {/* Terminal area */}
      <div className="min-h-[200px] p-3 font-mono text-[11px]">
        {/* Command line */}
        <div className="text-gray-700">
          <span className="text-gray-400">$ </span>
          {commandConfirmed ? (
            <span className="rounded bg-gray-100 px-1 py-0.5 text-green-700">{commandText}</span>
          ) : (
            commandText
          )}
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
            <div className="border-b border-gray-100 px-2.5 py-1 text-[9px] font-medium uppercase tracking-wider text-gray-400">
              Prompts
            </div>
            <div className="py-0.5">
              {PICKER_ITEMS.map((item, i) => (
                <div
                  key={item}
                  className={`px-2.5 py-1 text-[11px] transition-colors duration-150 ${
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
          <div className="mt-3 text-[11px] text-gray-400">
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
                className="text-[11px] text-gray-600"
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

function ConnectingArrow({ controls }: { controls: ReturnType<typeof useAnimation> }): ReactNode {
  return (
    <>
      {/* Horizontal arrow (desktop) */}
      <div className="relative hidden shrink-0 lg:flex lg:items-center" style={{ width: '28px' }}>
        <svg width="28" height="24" viewBox="0 0 28 24" className="overflow-visible">
          <motion.line
            x1="0" y1="12" x2="20" y2="12"
            stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="4 3"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={controls}
          />
          <motion.path
            d="M16 7 L26 12 L16 17"
            fill="none" stroke="#d1d5db" strokeWidth="1.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={controls}
          />
        </svg>
      </div>

      {/* Vertical arrow (mobile/tablet) */}
      <div className="relative flex flex-col items-center justify-center lg:hidden" style={{ height: '36px' }}>
        <svg width="24" height="36" viewBox="0 0 24 36" className="overflow-visible">
          <motion.line
            x1="12" y1="0" x2="12" y2="26"
            stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="4 3"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={controls}
          />
          <motion.path
            d="M7 22 L12 32 L17 22"
            fill="none" stroke="#d1d5db" strokeWidth="1.5"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={controls}
          />
        </svg>
      </div>
    </>
  )
}

export function CLIPromptAnimation({ onComplete }: { onComplete?: () => void } = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, margin: '-40px' })
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  // Tiddly state
  const [showForm, setShowForm] = useState(false)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [showTiddlyCursor, setShowTiddlyCursor] = useState(false)
  const [tiddlyTitle, setTiddlyTitle] = useState('')
  const [contentCharCount, setContentCharCount] = useState(0)

  // CLI state
  const [cliLines, setCliLines] = useState<CLILine[]>([])
  const [cliCurrentLine, setCliCurrentLine] = useState('')
  const [showCliCursor, setShowCliCursor] = useState(false)

  // Claude state
  const [claudeCommand, setClaudeCommand] = useState('')
  const [commandConfirmed, setCommandConfirmed] = useState(false)
  const [showCommandCursor, setShowCommandCursor] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerHighlight, setPickerHighlight] = useState(0)
  const [responseText, setResponseText] = useState('')
  const [showResponseCursor, setShowResponseCursor] = useState(false)
  const [visibleIssues, setVisibleIssues] = useState(0)

  const tiddlyControls = useAnimation()
  const arrow1Controls = useAnimation()
  const cliControls = useAnimation()
  const arrow2Controls = useAnimation()
  const claudeControls = useAnimation()

  useEffect(() => {
    if (!isInView) return

    const active = { current: true }

    async function typeCLICommand(
      text: string,
      charDelay: number,
    ): Promise<void> {
      setShowCliCursor(true)
      await typeText(setCliCurrentLine, text, charDelay, active)
      if (!active.current) return
      setShowCliCursor(false)
      setCliLines(prev => [...prev, { type: 'command', text }])
      setCliCurrentLine('')
    }

    async function addCLIOutput(line: string, type: 'success' | 'info'): Promise<void> {
      setCliLines(prev => [...prev, { type, text: line }])
      await delay(200)
    }

    async function playSequence(): Promise<void> {
      // === TIDDLY SIDE ===
      await tiddlyControls.start({
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return

      setShowForm(true)
      setShowPlaceholder(true)
      await delay(400)
      if (!active.current) return

      setShowPlaceholder(false)
      setShowTiddlyCursor(true)
      await delay(200)
      if (!active.current) return

      await typeText(setTiddlyTitle, 'code-review', 45, active)
      if (!active.current) return
      setShowTiddlyCursor(false)
      await delay(150)
      if (!active.current) return

      await animateCount(setContentCharCount, TEMPLATE_TEXT.length, 15, active)
      if (!active.current) return
      await delay(300)
      if (!active.current) return

      // === ARROW 1 ===
      await arrow1Controls.start({
        pathLength: 1, opacity: 1,
        transition: { duration: 0.4, ease: 'easeInOut' },
      })
      if (!active.current) return

      // === CLI TERMINAL ===
      setCliLines(INITIAL_CLI_LINES)
      await cliControls.start({
        opacity: 1, y: 0,
        transition: { duration: 0.5, ease: 'easeOut' },
      })
      if (!active.current) return
      await delay(400)
      if (!active.current) return

      // Type: tiddly login
      await typeCLICommand('tiddly login', 35)
      if (!active.current) return
      await addCLIOutput('✓ Authenticated', 'success')
      if (!active.current) return
      await delay(300)
      if (!active.current) return

      // Type: tiddly mcp configure
      await typeCLICommand('tiddly mcp configure claude-code --servers prompts', 25)
      if (!active.current) return
      await addCLIOutput('✓ Claude Code detected', 'success')
      if (!active.current) return
      await addCLIOutput('✓ Prompts server configured', 'success')
      if (!active.current) return
      await delay(400)
      if (!active.current) return

      // === ARROW 2 ===
      await arrow2Controls.start({
        pathLength: 1, opacity: 1,
        transition: { duration: 0.4, ease: 'easeInOut' },
      })
      if (!active.current) return

      // === CLAUDE CODE ===
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

      // Picker: navigate to code-review
      setShowPicker(true)
      setPickerHighlight(0)
      await delay(400)
      if (!active.current) return
      setPickerHighlight(1)
      await delay(350)
      if (!active.current) return
      setPickerHighlight(2)
      await delay(500)
      if (!active.current) return

      // Select
      setShowPicker(false)
      setClaudeCommand('/code-review')
      setCommandConfirmed(true)
      await delay(400)
      if (!active.current) return

      // Agent response
      setShowResponseCursor(true)
      await typeText(setResponseText, 'Analyzing code...', 30, active)
      if (!active.current) return
      setShowResponseCursor(false)
      await delay(400)
      if (!active.current) return

      // Issues stream in
      setVisibleIssues(1)
      await delay(300)
      if (!active.current) return
      setVisibleIssues(2)
      await delay(300)
      if (!active.current) return
      setVisibleIssues(3)
      await delay(1500)
      if (!active.current) return
      onCompleteRef.current?.()
    }

    playSequence()

    return () => { active.current = false }
  }, [isInView, tiddlyControls, arrow1Controls, cliControls, arrow2Controls, claudeControls])

  return (
    <div ref={containerRef}>
      <div className="mx-auto py-6">
        <div className="flex flex-col items-stretch justify-center gap-3 lg:flex-row lg:items-center lg:gap-0">
          {/* Tiddly app */}
          <motion.div
            className="min-w-0 lg:flex-1"
            initial={{ opacity: 0, y: 20 }}
            animate={tiddlyControls}
          >
            <TiddlyPanel
              showForm={showForm}
              showPlaceholder={showPlaceholder}
              titleText={tiddlyTitle}
              showTitleCursor={showTiddlyCursor}
              contentCharCount={contentCharCount}
            />
            <div className="mt-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-400">
              1. Create prompt
            </div>
          </motion.div>

          {/* Arrow 1 */}
          <ConnectingArrow controls={arrow1Controls} />

          {/* CLI Terminal */}
          <motion.div
            className="min-w-0 lg:flex-1"
            initial={{ opacity: 0, y: 20 }}
            animate={cliControls}
          >
            <CLITerminalPanel
              lines={cliLines}
              currentLine={cliCurrentLine}
              showCursor={showCliCursor}
            />
            <div className="mt-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-400">
              2. Configure via CLI
            </div>
          </motion.div>

          {/* Arrow 2 */}
          <ConnectingArrow controls={arrow2Controls} />

          {/* Claude Code */}
          <motion.div
            className="min-w-0 lg:flex-1"
            initial={{ opacity: 0, x: 30 }}
            animate={claudeControls}
          >
            <ClaudeCodePanel
              commandText={claudeCommand}
              commandConfirmed={commandConfirmed}
              showCommandCursor={showCommandCursor}
              showPicker={showPicker}
              pickerHighlight={pickerHighlight}
              responseText={responseText}
              showResponseCursor={showResponseCursor}
              visibleIssues={visibleIssues}
            />
            <div className="mt-2 text-center text-[10px] font-medium uppercase tracking-wider text-gray-400">
              3. Use in Claude Code
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
