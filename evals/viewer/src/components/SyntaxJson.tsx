/**
 * Lightweight JSON syntax highlighting — no dependencies.
 *
 * Colors keys, strings, numbers, booleans, and null differently
 * for easier scanning of JSON output.
 */
import type { ReactNode } from 'react'

interface SyntaxJsonProps {
  data: unknown
  className?: string
}

function highlightJson(json: string): ReactNode[] {
  // Match JSON tokens: keys, strings, numbers, booleans, null
  const tokenRegex = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|([-+]?\d+\.?\d*(?:[eE][-+]?\d+)?)\b|(true|false)|(null)/g

  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let keyId = 0

  while ((match = tokenRegex.exec(json)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      parts.push(json.slice(lastIndex, match.index))
    }

    if (match[1]) {
      // Key (quoted string followed by colon)
      parts.push(
        <span key={keyId++} className="text-gray-500">{match[1]}</span>,
      )
      parts.push(':')
    } else if (match[2]) {
      // String value
      parts.push(
        <span key={keyId++} className="text-blue-600">{match[2]}</span>,
      )
    } else if (match[3]) {
      // Number
      parts.push(
        <span key={keyId++} className="text-amber-600">{match[3]}</span>,
      )
    } else if (match[4]) {
      // Boolean
      parts.push(
        <span key={keyId++} className="text-purple-600">{match[4]}</span>,
      )
    } else if (match[5]) {
      // Null
      parts.push(
        <span key={keyId++} className="text-gray-400">{match[5]}</span>,
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < json.length) {
    parts.push(json.slice(lastIndex))
  }

  return parts
}

export default function SyntaxJson({ data, className = '' }: SyntaxJsonProps) {
  if (data === undefined || data === null) {
    return (
      <pre className={`text-xs bg-gray-50 p-2.5 rounded text-gray-400 ${className}`}>
        {String(data)}
      </pre>
    )
  }
  const json = JSON.stringify(data, null, 2)
  const highlighted = highlightJson(json)

  return (
    <pre className={`text-xs bg-gray-50 p-2.5 rounded overflow-x-auto whitespace-pre-wrap ${className}`}>
      {highlighted}
    </pre>
  )
}
