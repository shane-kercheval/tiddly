/**
 * Minimal YAML-frontmatter parser for prose `.md` files.
 *
 * Prose files carry a small metadata block (route, title, description) that feeds
 * both the SPA (page title) and the served `/prose/index.json` manifest. We parse
 * it ourselves rather than add `gray-matter`/`remark-frontmatter`: the metadata is
 * flat `key: value` strings, so a full YAML engine is unwarranted. This module has
 * no browser dependencies so the Vite build plugin can reuse it Node-side.
 */
export interface ProseFrontmatter {
  route: string
  title: string
  description: string
}

const REQUIRED_KEYS: (keyof ProseFrontmatter)[] = ['route', 'title', 'description']

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Split a prose file into its frontmatter and body. Throws if the frontmatter
 * block is missing or omits a required key — a fail-fast guard so a malformed
 * file surfaces in tests/build rather than rendering a blank page.
 */
export function parseProseFile(raw: string, source: string): { data: ProseFrontmatter; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  if (match === null) {
    throw new Error(`Prose file ${source} is missing its frontmatter block`)
  }
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    fields[line.slice(0, idx).trim()] = stripQuotes(line.slice(idx + 1).trim())
  }
  for (const key of REQUIRED_KEYS) {
    if (!fields[key]) {
      throw new Error(`Prose file ${source} is missing required frontmatter key "${key}"`)
    }
  }
  return {
    data: { route: fields.route, title: fields.title, description: fields.description },
    body: raw.slice(match[0].length),
  }
}
