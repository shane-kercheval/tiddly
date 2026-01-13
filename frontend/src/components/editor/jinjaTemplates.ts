/**
 * Shared Jinja2 template strings for editor toolbar insertion.
 * Used by both MilkdownEditor and CodeMirrorEditor.
 */

/** Jinja2 variable placeholder: {{ variable }} */
export const JINJA_VARIABLE = '{{ variable }}'

/** Jinja2 if block (standard) */
export const JINJA_IF_BLOCK = '{% if variable %}\n\n{% endif %}'

/** Jinja2 if block with whitespace trimming */
export const JINJA_IF_BLOCK_TRIM = '{%- if variable %}\n\n{%- endif %}'
