/**
 * Tests for list markers in the reading-mode Milkdown preview when a list mixes
 * checklist and plain items, asserting the real `index.css` rule against the
 * ACTUAL Milkdown-parsed DOM.
 *
 * jsdom doesn't run Tailwind, so computed `list-style` isn't available here.
 * Instead the tests parse the stylesheet source with PostCSS: they check which
 * lists the checklist-indent selector matches, and that no rule hiding list
 * markers matches a plain item or the list holding it. This reads source CSS,
 * so it can't see the compiled cascade or a marker hidden some other way (e.g.
 * `display: none` on the item).
 */
import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import type { Rule } from 'postcss'
import { MilkdownEditor } from './MilkdownEditor'

// Read from disk: Vitest stubs CSS imports to an empty string, even with `?raw`.
const indexCss = postcss.parse(readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8'))

const ISSUE_174 = "- Top plain\n    - Line 2\n    - Line 3\n\n- [ ] Line 1\n    - Nested plain\n    - [ ] Line 4\n    - [ ] Line 5"
const TIGHT_AND_LOOSE = '- tight A\n- [ ] tight task\n- tight B\n\nBreak.\n\n- loose A\n\n- [x] loose task\n\n- loose B'
const DEEP_CHECKBOX = '- top plain\n  - mid plain\n    - [ ] deep task\n- top plain 2'

function allRules(): Rule[] {
  const rules: Rule[] = []
  indexCss.walkRules((rule) => {
    rules.push(rule)
  })
  return rules
}

/** The selector of the `ul:has(... checklist item ...)` indent rule, whatever its attribute quoting. */
function checklistIndentSelector(): string {
  const selectors = allRules()
    .flatMap((rule) => rule.selectors)
    .filter((selector) => selector.includes('ul:has(') && /data-item-type=["']?task["']?\]/.test(selector))
  expect(selectors).toHaveLength(1)
  return selectors[0]
}

function hidesMarkers(rule: Rule): boolean {
  if (rule.selector.includes('::marker')) return true
  let hides = false
  rule.each((node) => {
    if (node.type === 'decl' && /^list-style(-type)?$/.test(node.prop) && /\bnone\b/.test(node.value)) hides = true
    if (node.type === 'atrule' && node.name === 'apply' && node.params.split(/\s+/).includes('list-none')) hides = true
  })
  return hides
}

/**
 * Selectors of every rule that hides list markers, with pseudo-elements removed:
 * jsdom's `matches()` returns false for a pseudo-element selector, which would
 * skip a `::marker` rule silently.
 */
function markerHidingSelectors(): string[] {
  return allRules()
    .filter(hidesMarkers)
    .flatMap((rule) => rule.selectors)
    .map((selector) => selector.replace(/::?(marker|before|after)\b/g, '').trim() || '*')
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
  it('no marker-hiding rule matches a plain item or the list holding it', async () => {
    const hiding = markerHidingSelectors()
    // Guards against a vacuous pass: the checklist items' own `list-none` rule must be found.
    expect(hiding.some((selector) => /li\[data-item-type=["']?task["']?\]$/.test(selector))).toBe(true)

    for (const markdown of [ISSUE_174, TIGHT_AND_LOOSE, DEEP_CHECKBOX]) {
      const container = await renderPreview(markdown)
      const plainItems = Array.from(container.querySelectorAll('.ProseMirror li:not([data-item-type="task"])'))
      expect(plainItems.length).toBeGreaterThan(0)

      const hidden = plainItems.flatMap((li) =>
        [li, li.parentElement!].flatMap((el) =>
          hiding.filter((selector) => el.matches(selector)).map((selector) => `${ownText(li)} <${el.tagName.toLowerCase()}>: ${selector}`),
        ),
      )
      expect(hidden).toEqual([])
    }
  })

  it('issue 174 markdown: only lists with a direct checklist item match', async () => {
    const container = await renderPreview(ISSUE_174)

    expect(listMatches(container, checklistIndentSelector())).toEqual([
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
    const container = await renderPreview(TIGHT_AND_LOOSE)

    expect(listMatches(container, checklistIndentSelector())).toEqual([
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
    const container = await renderPreview(DEEP_CHECKBOX)

    expect(listMatches(container, checklistIndentSelector())).toEqual([
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
