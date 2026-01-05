/**
 * Form utility functions.
 */
import type { KeyboardEvent } from 'react'

/**
 * Prevents Enter key from submitting a form.
 * Allows Enter in textareas for multiline input.
 * Use with onKeyDown on form elements when only Cmd+S should submit.
 */
export function preventEnterSubmit(e: KeyboardEvent<HTMLFormElement>): void {
  if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault()
  }
}
