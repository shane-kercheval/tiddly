/**
 * Extracts template variables from Jinja2/Nunjucks templates using AST parsing.
 *
 * Uses nunjucks parser to generate an AST and walks it to find all variable
 * references. This is more reliable than regex-based extraction because it
 * properly handles:
 * - Keywords like `not`, `and`, `or` (not captured as variables)
 * - Compound conditions like `{% if user and team %}`
 * - Nested access like `{{ user.name }}` (extracts root `user`)
 * - Loop variables vs iterables (captures iterable, not loop var)
 */
import * as nunjucks from 'nunjucks'

// Get node type constructors for instanceof checks
const nodes = nunjucks.nodes

/**
 * Set of Jinja2 built-in variables/functions that should not be treated as
 * user-defined variables.
 */
const BUILTIN_NAMES = new Set([
  // Jinja2 built-in globals
  'range',
  'dict',
  'lipsum',
  'cycler',
  'joiner',
  'namespace',
  // Jinja2 built-in tests (used with 'is')
  'defined',
  'undefined',
  'none',
  'true',
  'false',
  // Loop variable (available inside for loops)
  'loop',
])

/**
 * Extracts all user-defined variable names from a Jinja2/Nunjucks template.
 *
 * @param template - The template string to parse
 * @returns Object containing:
 *   - variables: Set of variable names found in the template
 *   - error: Parse error message if template is invalid, undefined otherwise
 */
export function extractTemplateVariables(template: string): {
  variables: Set<string>
  error?: string
} {
  const variables = new Set<string>()

  if (!template.trim()) {
    return { variables }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ast: any
  try {
    // Parse template into AST
    ast = nunjucks.parser.parse(template)
  } catch (e) {
    // Template has syntax errors - return empty set with error
    const error = e instanceof Error ? e.message : 'Template parse error'
    return { variables, error }
  }

  // Track variables defined within the template (loop vars, set vars)
  const localVars = new Set<string>()

  /**
   * Extracts the root variable name from a Symbol or LookupVal node.
   * For LookupVal chains (a.b.c), returns the leftmost symbol (a).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractRootVariable(node: any): string | null {
    if (node instanceof nodes.Symbol) {
      return node.value
    }
    if (node instanceof nodes.LookupVal) {
      // Recursively find the root
      return extractRootVariable(node.target)
    }
    return null
  }

  /**
   * Adds a variable to the result set if it's not a builtin or local var.
   */
  function addVariable(name: string): void {
    if (name && !BUILTIN_NAMES.has(name) && !localVars.has(name)) {
      variables.add(name)
    }
  }

  /**
   * Collects loop variable names from a For node's name property.
   * Handles both single vars (item) and tuple unpacking (key, value).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collectLoopVars(node: any, vars: Set<string>): void {
    if (node instanceof nodes.Symbol) {
      vars.add(node.value)
    } else if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        collectLoopVars(child, vars)
      }
    }
  }

  /**
   * Recursively walks the AST to find variable references.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walkNode(node: any): void {
    if (!node || typeof node !== 'object') return

    // Symbol: simple variable reference like `user`
    if (node instanceof nodes.Symbol) {
      addVariable(node.value)
      return
    }

    // LookupVal: nested access like `user.name` - extract root only
    if (node instanceof nodes.LookupVal) {
      const root = extractRootVariable(node)
      if (root) {
        addVariable(root)
      }
      return
    }

    // Skip Literal (string constants) and TemplateData (raw text)
    if (node instanceof nodes.Literal || node instanceof nodes.TemplateData) {
      return
    }

    // Filter: {{ value | filtername }} - walk the value, not the filter
    if (node instanceof nodes.Filter) {
      // Filter's first arg (in args.children) is the value being filtered
      if (node.args && node.args.children && node.args.children.length > 0) {
        walkNode(node.args.children[0])
      }
      return
    }

    // For loop: {% for item in items %}
    if (node instanceof nodes.For) {
      // Add loop variable(s) to localVars first
      if (node.name) {
        collectLoopVars(node.name, localVars)
      }
      // Walk the iterable expression
      walkNode(node.arr)
      // Walk the loop body and else clause
      walkNode(node.body)
      walkNode(node.else_)
      return
    }

    // Set statement: {% set x = value %}
    if (node instanceof nodes.Set) {
      // Add set targets to localVars
      if (node.targets) {
        for (const target of node.targets) {
          if (target instanceof nodes.Symbol) {
            localVars.add(target.value)
          }
        }
      }
      // Walk the value expression
      walkNode(node.value)
      return
    }

    // Not operator: {% if not user %}
    if (node instanceof nodes.Not) {
      walkNode(node.target)
      return
    }

    // Binary operators: And, Or, In, Add, Sub, etc.
    if (node instanceof nodes.And || node instanceof nodes.Or || node instanceof nodes.In) {
      walkNode(node.left)
      walkNode(node.right)
      return
    }

    // Other binary operators (arithmetic, etc.)
    if (node instanceof nodes.BinOp || node instanceof nodes.Add || node instanceof nodes.Sub ||
        node instanceof nodes.Mul || node instanceof nodes.Div || node instanceof nodes.Mod) {
      walkNode(node.left)
      walkNode(node.right)
      return
    }

    // Compare: {% if count > 0 %}
    if (node instanceof nodes.Compare) {
      walkNode(node.expr)
      if (node.ops && Array.isArray(node.ops)) {
        for (const op of node.ops) {
          walkNode(op.expr)
        }
      }
      return
    }

    // Is test: {% if var is defined %}
    if (node instanceof nodes.Is) {
      walkNode(node.left)
      // Don't walk right side - it's the test name (defined, none, etc.)
      return
    }

    // If statement: {% if cond %}body{% else %}else{% endif %}
    if (node instanceof nodes.If) {
      walkNode(node.cond)
      walkNode(node.body)
      walkNode(node.else_)
      return
    }

    // InlineIf (ternary): {{ body if cond else else_ }}
    if (node instanceof nodes.InlineIf) {
      walkNode(node.cond)
      walkNode(node.body)
      walkNode(node.else_)
      return
    }

    // FunCall: {{ func() }} or {{ obj.method() }}
    if (node instanceof nodes.FunCall) {
      walkNode(node.name)
      // Don't walk args - they might include literals
      if (node.args && node.args.children) {
        for (const arg of node.args.children) {
          walkNode(arg)
        }
      }
      return
    }

    // Output: {{ expression }}
    if (node instanceof nodes.Output) {
      if (node.children) {
        for (const child of node.children) {
          walkNode(child)
        }
      }
      return
    }

    // NodeList, Root, Group, Array - walk children
    if (node instanceof nodes.NodeList || node instanceof nodes.Root ||
        node instanceof nodes.Group || node instanceof nodes.Array) {
      if (node.children) {
        for (const child of node.children) {
          walkNode(child)
        }
      }
      return
    }

    // Default: walk common child properties for any other node types
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        walkNode(child)
      }
    }
    if (node.body) walkNode(node.body)
    if (node.cond) walkNode(node.cond)
    if (node.else_) walkNode(node.else_)
  }

  walkNode(ast)

  return { variables }
}
