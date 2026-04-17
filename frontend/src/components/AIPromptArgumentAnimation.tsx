import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion, useAnimation, useInView } from 'motion/react'
import { delay } from './animationUtils'

const TEMPLATE_TEXT = `Review the following {{ language }} code for bugs,
security issues, and best practices.

\`\`\`
{{ code }}
\`\`\`

Focus on: {{ focus_area }}`

interface GeneratedArg {
  name: string
  description: string
  required: boolean
}

const GENERATED_ARGS: GeneratedArg[] = [
  { name: 'language', description: 'The programming language of the code', required: true },
  { name: 'code', description: 'The code to review', required: true },
  { name: 'focus_area', description: 'Specific area to focus the review on', required: false },
]

/** Renders template text with {{ variables }} highlighted */
function TemplateContent({ text }: { text: string }): ReactNode {
  const parts: ReactNode[] = []
  const regex = /(\{\{.*?\}\})/g
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>)
    }
    parts.push(
      <span key={key++} className="rounded bg-amber-50 px-0.5 text-amber-700">{match[1]}</span>
    )
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>)
  }

  return <>{parts}</>
}

export function AIPromptArgumentAnimation({ onComplete }: { onComplete?: () => void } = {}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const isInView = useInView(containerRef, { once: true, margin: '-40px' })
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  const [typedText, setTypedText] = useState('')
  const [showArgs, setShowArgs] = useState(false)
  const [visibleArgs, setVisibleArgs] = useState(0)
  const [showClickRing, setShowClickRing] = useState(false)
  const [showSpinner, setShowSpinner] = useState(false)
  const [showCursor, setShowCursor] = useState(false)

  const controls = useAnimation()

  useEffect(() => {
    if (!isInView) return
    const active = { current: true }

    async function typeOut(text: string, charDelay: number): Promise<void> {
      for (let i = 1; i <= text.length; i++) {
        if (!active.current) return
        setTypedText(text.slice(0, i))
        await delay(charDelay)
      }
    }

    async function playSequence(): Promise<void> {
      await controls.start({ opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } })
      if (!active.current) return
      await delay(400)
      if (!active.current) return

      // Type out the template
      setShowCursor(true)
      await typeOut(TEMPLATE_TEXT, 18)
      if (!active.current) return
      setShowCursor(false)
      await delay(800)
      if (!active.current) return

      // Click the generate button
      setShowClickRing(true)
      await delay(500)
      if (!active.current) return
      setShowClickRing(false)

      // Spinner while AI analyzes
      setShowSpinner(true)
      await delay(800)
      if (!active.current) return
      setShowSpinner(false)

      // Arguments appear one by one
      setShowArgs(true)
      for (let i = 1; i <= GENERATED_ARGS.length; i++) {
        setVisibleArgs(i)
        await delay(400)
        if (!active.current) return
      }

      await delay(2500)
      if (!active.current) return

      onCompleteRef.current?.()
    }

    playSequence()
    return () => { active.current = false }
  }, [isInView, controls])

  return (
    <div ref={containerRef}>
      <div className="mx-auto max-w-2xl px-6 py-6 sm:px-8">
        <motion.div
          className="flex justify-center"
          initial={{ opacity: 0, y: 20 }}
          animate={controls}
        >
          <div className="w-[460px] max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
              </div>
              <span className="ml-1 text-xs font-medium text-gray-500">Tiddly</span>
            </div>

            <div className="p-4">
              {/* Prompt header */}
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">Prompt</div>
              <div className="mb-3 text-sm font-semibold text-gray-800">Code Review</div>

              {/* Template editor — typed out */}
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed min-h-[120px]">
                <TemplateContent text={typedText} />
                {showCursor && (
                  <motion.span
                    className="ml-px inline-block w-[1.5px] bg-gray-800"
                    style={{ height: '1em', verticalAlign: 'text-bottom' }}
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
                  />
                )}
              </div>

              {/* Arguments section */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-700">Arguments</span>

                {/* Generate button with sparkle */}
                <div className="relative">
                  <div className="inline-flex items-center justify-center h-5 w-5 rounded text-gray-400">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  {showClickRing && (
                    <motion.div
                      className="absolute -inset-1 rounded-full border-2 border-blue-400"
                      initial={{ scale: 0.5, opacity: 1 }}
                      animate={{ scale: 1.8, opacity: 0 }}
                      transition={{ duration: 0.5 }}
                    />
                  )}
                </div>

                {showSpinner && (
                  <div className="h-3.5 w-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                )}
              </div>

              {/* Generated arguments */}
              {showArgs && (
                <div className="space-y-2">
                  {GENERATED_ARGS.slice(0, visibleArgs).map((arg, i) => (
                    <motion.div
                      key={arg.name}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.05 }}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[11px] font-medium text-gray-800">{arg.name}</span>
                        {arg.required && (
                          <span className="rounded bg-red-50 px-1 py-px text-[9px] font-medium text-red-500">required</span>
                        )}
                        {!arg.required && (
                          <span className="rounded bg-gray-100 px-1 py-px text-[9px] font-medium text-gray-400">optional</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500">{arg.description}</div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
