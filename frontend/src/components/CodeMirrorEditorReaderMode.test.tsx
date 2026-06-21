/**
 * Tests for CodeMirrorEditor's reader mode (public share view): the text
 * formatting toolbar (whose buttons mutate content) is hidden, while the
 * view-only controls (wrap/lines/mono/reading/copy) remain. This is the fix for
 * the public view leaking edits through the formatting toolbar.
 */
import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { CodeMirrorEditor } from './CodeMirrorEditor'

const viewControlHandlers = {
  onWrapTextChange: () => {},
  onLineNumbersChange: () => {},
  onMonoFontChange: () => {},
}

function buttonCount(container: HTMLElement): number {
  return container.querySelectorAll('button').length
}

describe('CodeMirrorEditor — reader mode', () => {
  it('hides the formatting toolbar but keeps the view-only controls', () => {
    const { container: normal } = render(
      <CodeMirrorEditor value="hello" onChange={() => {}} copyContent="hello" {...viewControlHandlers} />
    )
    const { container: reader } = render(
      <CodeMirrorEditor value="hello" onChange={() => {}} copyContent="hello" readerMode {...viewControlHandlers} />
    )

    // Reader mode drops the entire formatting group -> strictly fewer buttons.
    expect(buttonCount(reader)).toBeLessThan(buttonCount(normal))
    // ...but the copy view-control is still available.
    expect(within(reader).getByLabelText('Copy content')).toBeInTheDocument()
  })
})
