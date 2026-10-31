/**
 * Tests for list markers in the reading-mode Milkdown preview when a list mixes
 * checklist and plain items, asserting the real `index.css` rule against the
 * ACTUAL Milkdown-parsed DOM.
 *
 * jsdom doesn't run Tailwind, so computed `list-style` isn't available here.
 * Instead the test reads the checklist-parent rule from the stylesheet source,
 * checks which lists its selector matches, and checks that it doesn't strip
 * list markers, which would hide the bullets of plain items in the same list.
 */
import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MilkdownEditor } from './MilkdownEditor'

// Read from disk: Vitest stubs CSS imports to an empty string, even with `?raw`.
const indexCss = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')

interface CssRule {
  selector: string
  body: string
}

/** The single `index.css` rule whose selector uses `:has()` on checklist items. */
function checklistParentRule(): CssRule {
  const rules = [...indexCss.matchAll(/([^{}]*:has\([^)]*data-item-type="task"[^)]*\)[^{}]*)\{([^}]*)\}/g)]
  expect(rules).toHaveLength(1)
  return { selector: rules[0][1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: rules[0][2] }
}

async function renderPreview(value: string): Promise<HTMLElement> {
  const { container } = render(<MilkdownEditor value={value} onChange={() => {}} readOnly={true} />)
  await waitFor(() => expect(container.querySelector('.ProseMirror li')).toBeTruthy())
  return container
}

function ownText(li: Element): string {
  return li.querySelector(':scope > p')?.textContent ?? ''
}

/** Each list in document order as [first item's text, whether the selector matches it]. */
function listMatches(container: HTMLElement, selector: string): Array<[string, boolean]> {
  return Array.from(container.querySelectorAll('.ProseMirror ul, .ProseMirror ol')).map((list) => [
    ownText(list.querySelector(':scope > li')!),
    list.matches(selector),
  ])
}

/** Each list item in document order as [text, whether it is tagged as a checklist item]. */
function itemTags(container: HTMLElement): Array<[string, boolean]> {
  return Array.from(container.querySelectorAll('.ProseMirror li')).map((li) => [
    ownText(li),
    li.getAttribute('data-item-type') === 'task',
  ])
}

describe('MilkdownEditor — mixed checklist and plain lists (reading mode)', () => {
  it('the checklist-parent rule does not strip list markers', () => {
    const { body } = checklistParentRule()
    expect(body).not.toMatch(/list-none|list-style/)
  })

  it('issue 174 markdown: only lists with a direct checklist item match', async () => {
    const container = await renderPreview(
      "- Top plain\n    - Line 2\n    - Line 3\n\n- [ ] Line 1\n    - Nested plain\n    - [ ] Line 4\n    - [ ] Line 5",
    )

    expect(listMatches(container, checklistParentRule().selector)).toEqual([
      ['Top plain', true],
      ['Line 2', false],
      ['Nested plain', true],
    ])
    expect(itemTags(container)).toEqual([
      ['Top plain', false],
      ['Line 2', false],
      ['Line 3', false],
      ['Line 1', true],
      ['Nested plain', false],
      ['Line 4', true],
      ['Line 5', true],
    ])
  })

  it('tight and loose mixed lists: plain items stay untagged', async () => {
    const container = await renderPreview('- tight A\n- [ ] tight task\n- tight B\n\nBreak.\n\n- loose A\n\n- [x] loose task\n\n- loose B')

    expect(listMatches(container, checklistParentRule().selector)).toEqual([
      ['tight A', true],
      ['loose A', true],
    ])
    expect(itemTags(container)).toEqual([
      ['tight A', false],
      ['tight task', true],
      ['tight B', false],
      ['loose A', false],
      ['loose task', true],
      ['loose B', false],
    ])
  })

  it('checklist item two levels down: only its own list matches, not the ancestors', async () => {
    const container = await renderPreview('- top plain\n  - mid plain\n    - [ ] deep task\n- top plain 2')

    expect(listMatches(container, checklistParentRule().selector)).toEqual([
      ['top plain', false],
      ['mid plain', false],
      ['deep task', true],
    ])
    expect(itemTags(container)).toEqual([
      ['top plain', false],
      ['mid plain', false],
      ['deep task', true],
      ['top plain 2', false],
    ])
  })
})
