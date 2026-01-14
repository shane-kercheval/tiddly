import { Plugin } from '@milkdown/kit/prose/state'
import { ReplaceStep, Mapping } from '@milkdown/kit/prose/transform'
import type { Fragment, MarkType, Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'

interface LinkRange {
  start: number
  end: number
}

/**
 * Create a ProseMirror plugin that exits link marks when space is typed at the end of a link.
 * This prevents trailing text from unintentionally inheriting the link mark.
 */
export function createLinkExitOnSpacePlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.length) return

      const linkMarkType = newState.schema.marks.link
      if (!linkMarkType) return

      const mappingsAfter = buildMappingsAfter(transactions)
      const positionsToCheck = new Set<number>()

      for (let trIndex = 0; trIndex < transactions.length; trIndex++) {
        const tr = transactions[trIndex]
        if (!tr.docChanged || tr.getMeta('composing')) continue

        const mappingAfter = mappingsAfter[trIndex]

        for (let stepIndex = 0; stepIndex < tr.steps.length; stepIndex++) {
          const step = tr.steps[stepIndex]
          if (!(step instanceof ReplaceStep)) continue

          const stepData = step as unknown as { slice: { content: Fragment } }
          const spaceOffsets = findSpaceOffsetsInFragment(stepData.slice.content)
          if (!spaceOffsets.length) continue

          const stepMap = step.getMap()
          const mappingWithinTr = tr.mapping.slice(stepIndex + 1)

          stepMap.forEach((_from, _to, newFrom) => {
            for (const offset of spaceOffsets) {
              const posInStep = newFrom + offset
              const posInTr = mappingWithinTr.map(posInStep, -1)
              const posInFinal = mappingAfter.map(posInTr, -1)
              positionsToCheck.add(posInFinal)
            }
          })
        }
      }

      if (!positionsToCheck.size) return

      let tr = newState.tr
      for (const pos of positionsToCheck) {
        if (!isSpaceAtPosition(newState.doc, pos)) continue

        const cursorPos = pos + 1
        const linkRange = findLinkRangeInDoc(newState.doc, cursorPos, linkMarkType)
        if (!linkRange || cursorPos !== linkRange.end) continue

        tr = tr.removeMark(pos, pos + 1, linkMarkType)
      }

      return tr.steps.length ? tr : undefined
    },
  })
}

function buildMappingsAfter(transactions: readonly Transaction[]): Mapping[] {
  const mappingsAfter: Mapping[] = new Array(transactions.length)
  let mappingAfter = new Mapping()

  for (let i = transactions.length - 1; i >= 0; i--) {
    mappingsAfter[i] = mappingAfter

    const nextMapping = new Mapping()
    for (const map of transactions[i].mapping.maps) {
      nextMapping.appendMap(map)
    }
    for (const map of mappingAfter.maps) {
      nextMapping.appendMap(map)
    }
    mappingAfter = nextMapping
  }

  return mappingsAfter
}

function findSpaceOffsetsInFragment(fragment: Fragment): number[] {
  const offsets: number[] = []

  fragment.nodesBetween(0, fragment.size, (node, pos) => {
    if (!node.isText || !node.text) return

    let index = node.text.indexOf(' ')
    while (index !== -1) {
      offsets.push(pos + index)
      index = node.text.indexOf(' ', index + 1)
    }
  })

  return offsets
}

function isSpaceAtPosition(doc: ProseMirrorNode, pos: number): boolean {
  if (pos < 0 || pos + 1 > doc.content.size) return false

  try {
    return doc.textBetween(pos, pos + 1) === ' '
  } catch {
    return false
  }
}

function findLinkRangeInDoc(
  doc: ProseMirrorNode,
  cursorPos: number,
  linkMarkType: MarkType
): LinkRange | null {
  const $from = doc.resolve(cursorPos)

  let linkMark = linkMarkType.isInSet($from.marks())
  if (!linkMark && $from.nodeBefore) {
    linkMark = linkMarkType.isInSet($from.nodeBefore.marks)
  }

  if (!linkMark) return null

  const blockStart = $from.start($from.depth)
  const blockEnd = $from.end($from.depth)

  let linkStart = cursorPos
  let linkEnd = cursorPos

  doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (node.isText && node.marks.some((mark) => mark.type === linkMarkType)) {
      const nodeEnd = pos + node.nodeSize
      if (pos <= cursorPos && nodeEnd >= cursorPos) {
        linkStart = Math.min(linkStart, pos)
        linkEnd = Math.max(linkEnd, nodeEnd)
      }
    }
  })

  return { start: linkStart, end: linkEnd }
}
