import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnimationCarousel } from '../AnimationCarousel'

// Mock the three animation components so tests focus on carousel behavior
vi.mock('../PromptMCPAnimation', () => ({
  PromptMCPAnimation: ({ onComplete }: { onComplete?: () => void }) => (
    <div data-testid="prompt-animation">
      <button data-testid="trigger-complete-prompt" onClick={onComplete}>complete</button>
    </div>
  ),
}))

vi.mock('../NoteMCPAnimation', () => ({
  NoteMCPAnimation: ({ onComplete }: { onComplete?: () => void }) => (
    <div data-testid="note-animation">
      <button data-testid="trigger-complete-note" onClick={onComplete}>complete</button>
    </div>
  ),
}))

vi.mock('../ChromeExtensionAnimation', () => ({
  ChromeExtensionAnimation: ({ onComplete }: { onComplete?: () => void }) => (
    <div data-testid="chrome-animation">
      <button data-testid="trigger-complete-chrome" onClick={onComplete}>complete</button>
    </div>
  ),
}))

// Mock motion/react to render plain elements (avoids animation timing issues)
const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants',
  'whileHover', 'whileTap', 'whileFocus', 'whileDrag', 'whileInView',
  'layout', 'layoutId', 'onAnimationComplete',
])

vi.mock('motion/react', async () => {
  const React = await import('react')
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_target: unknown, prop: string) =>
        React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
          const filtered: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(props)) {
            if (!MOTION_PROPS.has(k)) filtered[k] = v
          }
          return React.createElement(prop, { ...filtered, ref })
        }),
    }),
  }
})

describe('AnimationCarousel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render first slide (Prompt) by default', () => {
    render(<AnimationCarousel />)

    expect(screen.getByTestId('prompt-animation')).toBeInTheDocument()
    expect(screen.queryByTestId('note-animation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chrome-animation')).not.toBeInTheDocument()
  })

  it('should show subtitle for current slide', () => {
    render(<AnimationCarousel />)

    expect(screen.getByText('Create prompt templates and use them in any AI agent via MCP')).toBeInTheDocument()
  })

  it('should render 3 dot indicators', () => {
    render(<AnimationCarousel />)

    const dots = screen.getAllByRole('button', { name: /Go to slide/ })
    expect(dots).toHaveLength(3)
  })

  it('should render prev/next arrow buttons', () => {
    render(<AnimationCarousel />)

    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeInTheDocument()
  })

  describe('navigation', () => {
    it('should go to next slide on next arrow click', async () => {
      const user = userEvent.setup()
      render(<AnimationCarousel />)

      await user.click(screen.getByRole('button', { name: 'Next slide' }))

      expect(screen.getByTestId('note-animation')).toBeInTheDocument()
      expect(screen.queryByTestId('prompt-animation')).not.toBeInTheDocument()
    })

    it('should go to previous slide on prev arrow click', async () => {
      const user = userEvent.setup()
      render(<AnimationCarousel />)

      // Navigate to slide 2 first
      await user.click(screen.getByRole('button', { name: 'Next slide' }))
      expect(screen.getByTestId('note-animation')).toBeInTheDocument()

      // Go back
      await user.click(screen.getByRole('button', { name: 'Previous slide' }))
      expect(screen.getByTestId('prompt-animation')).toBeInTheDocument()
    })

    it('should go to specific slide on dot click', async () => {
      const user = userEvent.setup()
      render(<AnimationCarousel />)

      await user.click(screen.getByRole('button', { name: 'Go to slide 3' }))

      expect(screen.getByTestId('chrome-animation')).toBeInTheDocument()
    })

    it('should wrap from last slide to first on next arrow', async () => {
      const user = userEvent.setup()
      render(<AnimationCarousel />)

      // Go to last slide
      await user.click(screen.getByRole('button', { name: 'Go to slide 3' }))
      expect(screen.getByTestId('chrome-animation')).toBeInTheDocument()

      // Next should wrap to first
      await user.click(screen.getByRole('button', { name: 'Next slide' }))
      expect(screen.getByTestId('prompt-animation')).toBeInTheDocument()
    })

    it('should wrap from first slide to last on prev arrow', async () => {
      const user = userEvent.setup()
      render(<AnimationCarousel />)

      expect(screen.getByTestId('prompt-animation')).toBeInTheDocument()

      // Prev on first slide should wrap to last
      await user.click(screen.getByRole('button', { name: 'Previous slide' }))
      expect(screen.getByTestId('chrome-animation')).toBeInTheDocument()
    })

    it('should update subtitle when navigating', async () => {
      const user = userEvent.setup()
      render(<AnimationCarousel />)

      await user.click(screen.getByRole('button', { name: 'Next slide' }))
      expect(screen.getByText('Claude reads and updates your notes through MCP')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Next slide' }))
      expect(screen.getByText('Bookmark any page with the Chrome extension')).toBeInTheDocument()
    })
  })

  describe('auto-advance', () => {
    it('should advance to next slide when animation completes', () => {
      render(<AnimationCarousel />)

      expect(screen.getByTestId('prompt-animation')).toBeInTheDocument()

      // Simulate animation completion
      act(() => {
        screen.getByTestId('trigger-complete-prompt').click()
      })

      expect(screen.getByTestId('note-animation')).toBeInTheDocument()
    })

    it('should wrap around on auto-advance from last slide', () => {
      render(<AnimationCarousel />)

      // Advance through all slides
      act(() => { screen.getByTestId('trigger-complete-prompt').click() })
      expect(screen.getByTestId('note-animation')).toBeInTheDocument()

      act(() => { screen.getByTestId('trigger-complete-note').click() })
      expect(screen.getByTestId('chrome-animation')).toBeInTheDocument()

      act(() => { screen.getByTestId('trigger-complete-chrome').click() })
      expect(screen.getByTestId('prompt-animation')).toBeInTheDocument()
    })
  })

  describe('onSignup', () => {
    it('should render Get Started button when onSignup is provided', () => {
      const onSignup = vi.fn()
      render(<AnimationCarousel onSignup={onSignup} />)

      expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument()
    })

    it('should call onSignup when Get Started button is clicked', async () => {
      const user = userEvent.setup()
      const onSignup = vi.fn()
      render(<AnimationCarousel onSignup={onSignup} />)

      await user.click(screen.getByRole('button', { name: 'Get Started' }))
      expect(onSignup).toHaveBeenCalledOnce()
    })

    it('should not render Get Started button when onSignup is not provided', () => {
      render(<AnimationCarousel />)

      expect(screen.queryByRole('button', { name: 'Get Started' })).not.toBeInTheDocument()
    })
  })
})
