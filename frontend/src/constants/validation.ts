/**
 * Shared validation constants for form fields.
 */

/** Regex for validating prompt names (lowercase with hyphens, must start/end with alphanumeric) */
export const PROMPT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Regex for validating argument names (lowercase with underscores, must start with a letter) */
export const ARG_NAME_PATTERN = /^[a-z][a-z0-9_]*$/
