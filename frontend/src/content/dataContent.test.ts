import { describe, it, expect } from 'vitest'
import { collectDataContent } from '../../plugins/dataContent'
import { getAllShortcuts } from '../shortcuts/registry'

describe('data content serving', () => {
  const { files, manifest } = collectDataContent(process.cwd())

  it('serves every data file with a manifest entry', () => {
    const paths = manifest.map((e) => e.path).sort()
    expect(paths).toEqual([
      '/data/changelog.json',
      '/data/faq.json',
      '/data/known-issues.json',
      '/data/roadmap.json',
      '/data/shortcuts.json',
      '/data/tiers.json',
      '/data/tips.json',
    ])
    for (const entry of manifest) {
      expect(entry.path).toMatch(/^\/data\/[a-z0-9-]+\.json$/)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('manifest entries map 1:1 to served files', () => {
    const fileNames = files.map((f) => f.name).sort()
    const manifestNames = manifest.map((e) => e.path.replace('/data/', '')).sort()
    expect(manifestNames).toEqual(fileNames)
  })

  it('shortcuts projection exposes only id/keys/label/section (no matcher or note)', () => {
    const file = files.find((f) => f.name === 'shortcuts.json')
    expect(file).toBeDefined()
    const projected = JSON.parse(file!.content) as Record<string, unknown>[]
    expect(projected.length).toBe(getAllShortcuts().length)
    for (const entry of projected) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'keys', 'label', 'section'])
      expect(entry).not.toHaveProperty('match')
      expect(entry).not.toHaveProperty('note')
    }
  })

  it('projection keys match the registry (derived display tokens)', () => {
    const file = files.find((f) => f.name === 'shortcuts.json')!
    const projected = JSON.parse(file.content) as { id: string; keys: string[] }[]
    const byId = new Map(projected.map((e) => [e.id, e.keys]))
    for (const shortcut of getAllShortcuts()) {
      expect(byId.get(shortcut.id)).toEqual([...shortcut.keys])
    }
  })

  it('every served data file is valid JSON', () => {
    for (const { content } of files) {
      expect(() => JSON.parse(content)).not.toThrow()
    }
  })

  it('serves tiers.json with product tiers only — never the runtime-only dev tier', () => {
    const file = files.find((f) => f.name === 'tiers.json')
    expect(file).toBeDefined()
    const tiers = JSON.parse(file!.content) as Record<string, unknown>
    expect(Object.keys(tiers).filter((k) => k !== '_comment').sort()).toEqual(['free', 'pro', 'standard'])
    expect(tiers).not.toHaveProperty('dev')
    // The display-only flag is present so consumers can render "Unlimited".
    expect((tiers.pro as { unlimited_items: boolean }).unlimited_items).toBe(true)
  })
})
