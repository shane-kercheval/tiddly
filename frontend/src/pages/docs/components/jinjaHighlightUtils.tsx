import type { ReactNode } from 'react'

// Jinja2 highlighting uses the prompt brand orange (#e2a66b) palette:
// - Delimiters: #d1955a (darker orange)
// - Variable content: #b37a3a on rgba(226, 166, 107, 0.1)
// - Tag content: #c4843e on rgba(226, 166, 107, 0.08)
// - Comments: #9ca3af italic

/**
 * Parses a string and returns JSX with Jinja2 syntax highlighted
 * using the prompt brand orange color palette.
 */
export function highlightJinja(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  // Match {{ ... }}, {%- ... -%}, {% ... %}, {# ... #}
  const regex = /(\{\{)(.*?)(\}\})|(\{%-?\s*)(.*?)(\s*-?%\})|(\{#)(.*?)(#\})/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1] !== undefined) {
      // Variable: {{ ... }}
      parts.push(
        <span key={match.index}>
          <span style={{ color: '#d1955a' }}>{match[1]}</span>
          <span style={{ color: '#b37a3a', backgroundColor: 'rgba(226, 166, 107, 0.1)', borderRadius: '2px' }}>{match[2]}</span>
          <span style={{ color: '#d1955a' }}>{match[3]}</span>
        </span>
      )
    } else if (match[4] !== undefined) {
      // Tag: {% ... %}
      parts.push(
        <span key={match.index}>
          <span style={{ color: '#d1955a' }}>{match[4]}</span>
          <span style={{ color: '#c4843e', backgroundColor: 'rgba(226, 166, 107, 0.08)', borderRadius: '2px' }}>{match[5]}</span>
          <span style={{ color: '#d1955a' }}>{match[6]}</span>
        </span>
      )
    } else if (match[7] !== undefined) {
      // Comment: {# ... #}
      parts.push(
        <span key={match.index} style={{ color: '#9ca3af', fontStyle: 'italic' }}>
          {match[0]}
        </span>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}
