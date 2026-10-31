/**
 * Tests for list markers in the reading-mode Milkdown preview when a list mixes
 * checklist and plain items, asserting the real `index.css` rule against the
 * ACTUAL Milkdown-parsed DOM.
 *
 * jsdom doesn't run Tailwind, so computed styles aren't available here.
 * Instead the tests parse the stylesheet source with PostCSS: no rule hiding
 * bullets (no marker, or a `display` other than `list-item`) may match a plain
 * item or, for markers, the list holding it, and no rule may take a checklist
 * item out of `display: list-item`. This reads source CSS, so it can't see the
 * compiled cascade, a bullet hidden from outside `index.css` (e.g. a
 * `list-none` class added from TSX), or where markers and checkboxes are drawn.
 */
import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import type { ChildNode, Container, Rule } from 'postcss'
import { MilkdownEditor } from './MilkdownEditor'

// Read from disk: Vitest stubs CSS imports to an empty string, even with `?raw`.
const indexCss = postcss.parse(readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8'))

const ISSUE_174 = "- Top plain\n    - Line 2\n    - Line 3\n\n- [ ] Line 1\n    - Nested plain\n    - [ ] Line 4\n    - [ ] Line 5"
const TIGHT_AND_LOOSE = '- tight A\n- [ ] tight task\n- tight B\n\nBreak.\n\n- loose A\n\n- [x] loose task\n\n- loose B'
const DEEP_CHECKBOX = '- top plain\n  - mid plain\n    - [ ] deep task\n- top plain 2'
const ORDERED_MIXED = '1. ordered one\n2. [ ] ordered task\n3. ordered three'

function allRules(): Rule[] {
  const rules: Rule[] = []
  indexCss.walkRules((rule) => {
    rules.push(rule)
  })
  return rules
}

/**
 * Which elements a bullet-hiding rule must not match: `list` for a marker
 * style, which list items inherit from their list; `item` for `display`, which
 * removes the bullet only from the element it's set on.
 */
type Reach = 'item' | 'list'

interface HidingSelector {
  selector: string
  reach: Reach
}

const DISPLAY_UTILITIES = ['flex', 'inline-flex', 'block', 'inline-block', 'inline', 'grid', 'inline-grid', 'hidden', 'contents', 'table', 'flow-root']

/** A rule's declarations and `@apply`s, including those inside at-rules nested in it (e.g. `@media`). */
function ownNodes(container: Container): ChildNode[] {
  const nodes: ChildNode[] = []
  container.each((node) => {
    if (node.type === 'rule') return
    nodes.push(node)
    if (node.type === 'atrule' && node.nodes) nodes.push(...ownNodes(node))
  })
  return nodes
}

/** The utility in an `@apply` token, without variants or `!` (`md:!list-none` → `list-none`). */
function utilityName(token: string): string | undefined {
  return token.match(/^(?:[\w-]+:)*!?([\w-]+)!?$/)?.[1]
}

function hidingReaches(rule: Rule): Set<Reach> {
  const reaches = new Set<Reach>()
  for (const node of ownNodes(rule)) {
    if (node.type === 'decl') {
      if (/^list-style(-type)?$/.test(node.prop) && /\bnone\b/.test(node.value)) reaches.add('list')
      if (node.prop === 'display' && !/\blist-item\b/.test(node.value)) reaches.add('item')
    } else if (node.type === 'atrule' && node.name === 'apply') {
      const utilities = node.params.split(/\s+/).map(utilityName)
      if (utilities.includes('list-none')) reaches.add('list')
      if (utilities.some((name) => name !== undefined && DISPLAY_UTILITIES.includes(name))) reaches.add('item')
    }
  }
  return reaches
}

/**
 * Selectors of every rule that hides bullets. Any `::marker` rule counts, with
 * the pseudo-element removed: jsdom's `matches()` returns false for it, which
 * would skip the rule silently. A `::before`/`::after` selector styles
 * generated content, not the item, so it doesn't count.
 */
function bulletHidingSelectors(): HidingSelector[] {
  return allRules().flatMap((rule) => {
    const reaches = hidingReaches(rule)
    return rule.selectors.flatMap((selector): HidingSelector[] => {
      if (selector.includes('::marker')) return [{ selector: selector.replace(/::marker\b/g, '').trim() || '*', reach: 'list' }]
      if (/::?(before|after)\b/.test(selector)) return []
      return [...reaches].map((reach) => ({ selector, reach }))
    })
  })
}

async function renderPreview(value: string): Promise<HTMLElement> {
  const { container } = render(<MilkdownEditor value={value} onChange={() => {}} readOnly={true} />)
  await waitFor(() => expect(container.querySelector('.ProseMirror li')).toBeTruthy())
  return container
}

function ownText(li: Element): string {
  return li.querySelector(':scope > p')?.textContent ?? ''
}

/** Each list item in document order as [text, whether it is tagged as a checklist item]. */
function itemTags(container: HTMLElement): Array<[string, boolean]> {
  return Array.from(container.querySelectorAll('.ProseMirror li')).map((li) => [
    ownText(li),
    li.getAttribute('data-item-type') === 'task',
  ])
}

describe('MilkdownEditor — mixed checklist and plain lists (reading mode)', () => {
  it('no bullet-hiding rule matches a plain item, and no marker-hiding rule its list', async () => {
    const hiding = bulletHidingSelectors()
    // Guards against a vacuous pass: the checklist items' own rule hides their markers (`list-none`).
    const checklistItemReaches = hiding.filter(({ selector }) => /li\[data-item-type=["']?task["']?\]$/.test(selector)).map(({ reach }) => reach)
    expect(checklistItemReaches).toContain('list')

    for (const markdown of [ISSUE_174, TIGHT_AND_LOOSE, DEEP_CHECKBOX]) {
      const container = await renderPreview(markdown)
      const plainItems = Array.from(container.querySelectorAll('.ProseMirror li:not([data-item-type="task"])'))
      expect(plainItems.length).toBeGreaterThan(0)

      const hidden = plainItems.flatMap((li) =>
        hiding
          .flatMap(({ selector, reach }) => (reach === 'list' ? [li, li.parentElement!] : [li]).map((el) => ({ el, selector, reach })))
          .filter(({ el, selector }) => el.matches(selector))
          .map(({ el, selector, reach }) => `${ownText(li)} <${el.tagName.toLowerCase()}> ${reach}: ${selector}`),
      )
      expect(hidden).toEqual([])
    }
  })

  it('checklist items keep display: list-item, so an ordered list counts them', async () => {
    const displayChanging = bulletHidingSelectors().filter(({ reach }) => reach === 'item')

    for (const markdown of [ISSUE_174, TIGHT_AND_LOOSE, DEEP_CHECKBOX, ORDERED_MIXED]) {
      const container = await renderPreview(markdown)
      const checklistItems = Array.from(container.querySelectorAll('.ProseMirror li[data-item-type="task"]'))
      expect(checklistItems.length).toBeGreaterThan(0)

      const moved = checklistItems.flatMap((li) =>
        displayChanging.filter(({ selector }) => li.matches(selector)).map(({ selector }) => `${ownText(li)}: ${selector}`),
      )
      expect(moved).toEqual([])
    }
  })

  it('issue 174 markdown: only checklist items are tagged', async () => {
    const container = await renderPreview(ISSUE_174)

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

    expect(itemTags(container)).toEqual([
      ['tight A', false],
      ['tight task', true],
      ['tight B', false],
      ['loose A', false],
      ['loose task', true],
      ['loose B', false],
    ])
  })

  it('checklist item two levels down: its plain ancestors stay untagged', async () => {
    const container = await renderPreview(DEEP_CHECKBOX)

    expect(itemTags(container)).toEqual([
      ['top plain', false],
      ['mid plain', false],
      ['deep task', true],
      ['top plain 2', false],
    ])
  })
})
