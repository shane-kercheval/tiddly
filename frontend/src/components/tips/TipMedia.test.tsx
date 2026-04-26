import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { TipMedia } from './TipMedia'

describe('TipMedia', () => {
  it('renders <img> for kind: image with src and alt', () => {
    const { container } = render(
      <TipMedia media={{ kind: 'image', src: '/x.png', alt: 'demo' }} />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', '/x.png')
    expect(img).toHaveAttribute('alt', 'demo')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders <video> for kind: video with autoPlay/muted/loop/playsInline', () => {
    const { container } = render(
      <TipMedia
        media={{
          kind: 'video',
          src: '/x.webm',
          alt: 'demo video',
          poster: '/x-poster.jpg',
        }}
      />,
    )
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('src', '/x.webm')
    expect(video).toHaveAttribute('poster', '/x-poster.jpg')
    expect(video).toHaveAttribute('aria-label', 'demo video')
    // Autoplay attributes — testing-library normalizes to lowercase or boolean.
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video?.autoplay).toBe(true)
    expect(video?.muted).toBe(true)
    expect(video?.loop).toBe(true)
    expect(video?.playsInline).toBe(true)
  })

  it('returns null for kind: component (registry is empty in v1)', () => {
    const { container } = render(<TipMedia media={{ kind: 'component', id: 'whatever' }} />)
    expect(container.firstChild).toBeNull()
  })
})
