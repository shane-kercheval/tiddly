import { useCallback, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChromeExtensionAnimation } from './ChromeExtensionAnimation'
import { PromptMCPAnimation } from './PromptMCPAnimation'
import { NoteMCPAnimation } from './NoteMCPAnimation'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

interface Slide {
  Component: ComponentType<{ onComplete?: () => void }>
  subtitle: string
}

const SLIDES: Slide[] = [
  {
    Component: PromptMCPAnimation,
    subtitle: 'Create prompt templates and use them in any AI agent via MCP',
  },
  {
    Component: NoteMCPAnimation,
    subtitle: 'Claude reads and updates your notes through MCP',
  },
  {
    Component: ChromeExtensionAnimation,
    subtitle: 'Bookmark any page with the Chrome extension',
  },
]

export function AnimationCarousel({ onSignup }: { onSignup?: () => void }): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0)

  const goTo = (index: number): void => {
    setActiveIndex((index + SLIDES.length) % SLIDES.length)
  }

  const handleComplete = useCallback((): void => {
    setActiveIndex((prev) => (prev + 1) % SLIDES.length)
  }, [])

  const ActiveComponent = SLIDES[activeIndex].Component

  return (
    <div className="mt-2 sm:mt-12">
      <div className="overflow-hidden lg:h-[350px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={`anim-${activeIndex}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <ActiveComponent onComplete={handleComplete} />
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`text-${activeIndex}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 text-center"
        >
          <p className="text-sm text-gray-500 sm:text-base">{SLIDES[activeIndex].subtitle}</p>
        </motion.div>
      </AnimatePresence>

      <div className="mt-3 flex items-center justify-center gap-3 sm:mt-4">
        <button
          onClick={() => goTo(activeIndex - 1)}
          className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 sm:p-2"
          aria-label="Previous slide"
        >
          <ChevronLeftIcon className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
        <div className="flex items-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === activeIndex ? 'bg-gray-800' : 'bg-gray-300 hover:bg-gray-400'
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
        <button
          onClick={() => goTo(activeIndex + 1)}
          className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 sm:p-2"
          aria-label="Next slide"
        >
          <ChevronRightIcon className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
      </div>

      {onSignup && (
        <div className="mt-6 text-center sm:hidden">
          <button
            onClick={onSignup}
            className="rounded-full bg-gray-900 px-8 py-3 text-base font-medium text-white transition-all hover:bg-gray-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
          >
            Get Started
          </button>
        </div>
      )}
    </div>
  )
}
