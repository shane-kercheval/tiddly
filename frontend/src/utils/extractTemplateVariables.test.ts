/**
 * Tests for extractTemplateVariables utility.
 *
 * Comprehensive tests for Jinja2/Nunjucks template variable extraction
 * using AST parsing.
 */
import { describe, it, expect } from 'vitest'
import { extractTemplateVariables } from './extractTemplateVariables'

describe('extractTemplateVariables', () => {
  describe('simple expressions', () => {
    it('should extract simple variable from {{ var }}', () => {
      const { variables } = extractTemplateVariables('Hello {{ name }}!')
      expect(variables).toEqual(new Set(['name']))
    })

    it('should extract multiple variables', () => {
      const { variables } = extractTemplateVariables('{{ greeting }}, {{ name }}!')
      expect(variables).toEqual(new Set(['greeting', 'name']))
    })

    it('should handle variable with no spaces', () => {
      const { variables } = extractTemplateVariables('{{name}}')
      expect(variables).toEqual(new Set(['name']))
    })

    it('should handle variable with extra whitespace', () => {
      const { variables } = extractTemplateVariables('{{   name   }}')
      expect(variables).toEqual(new Set(['name']))
    })

    it('should return empty set for template with no variables', () => {
      const { variables } = extractTemplateVariables('Hello World!')
      expect(variables).toEqual(new Set())
    })

    it('should return empty set for empty template', () => {
      const { variables } = extractTemplateVariables('')
      expect(variables).toEqual(new Set())
    })

    it('should return empty set for whitespace-only template', () => {
      const { variables } = extractTemplateVariables('   \n\t   ')
      expect(variables).toEqual(new Set())
    })
  })

  describe('dotted access (nested properties)', () => {
    it('should extract root variable from {{ user.name }}', () => {
      const { variables } = extractTemplateVariables('{{ user.name }}')
      expect(variables).toEqual(new Set(['user']))
    })

    it('should extract root from deeply nested access {{ user.profile.settings.theme }}', () => {
      const { variables } = extractTemplateVariables('{{ user.profile.settings.theme }}')
      expect(variables).toEqual(new Set(['user']))
    })

    it('should extract root from bracket notation {{ items["key"] }}', () => {
      const { variables } = extractTemplateVariables('{{ items["key"] }}')
      expect(variables).toEqual(new Set(['items']))
    })

    it('should extract root from mixed notation {{ user.settings["theme"] }}', () => {
      const { variables } = extractTemplateVariables('{{ user.settings["theme"] }}')
      expect(variables).toEqual(new Set(['user']))
    })

    it('should extract root from array index {{ items[0] }}', () => {
      const { variables } = extractTemplateVariables('{{ items[0] }}')
      expect(variables).toEqual(new Set(['items']))
    })

    it('should extract root from nested array access {{ matrix[0][1] }}', () => {
      const { variables } = extractTemplateVariables('{{ matrix[0][1] }}')
      expect(variables).toEqual(new Set(['matrix']))
    })
  })

  describe('filters', () => {
    it('should extract variable before filter {{ name | upper }}', () => {
      const { variables } = extractTemplateVariables('{{ name | upper }}')
      expect(variables).toEqual(new Set(['name']))
    })

    it('should extract variable with chained filters {{ name | upper | trim }}', () => {
      const { variables } = extractTemplateVariables('{{ name | upper | trim }}')
      expect(variables).toEqual(new Set(['name']))
    })

    it('should extract variable with filter having arguments {{ date | format("%Y-%m-%d") }}', () => {
      const { variables } = extractTemplateVariables('{{ date | format("%Y-%m-%d") }}')
      expect(variables).toEqual(new Set(['date']))
    })

    it('should extract root from dotted access with filter {{ user.name | capitalize }}', () => {
      const { variables } = extractTemplateVariables('{{ user.name | capitalize }}')
      expect(variables).toEqual(new Set(['user']))
    })
  })

  describe('for loops', () => {
    it('should extract iterable, not loop variable from {% for item in items %}', () => {
      const { variables } = extractTemplateVariables('{% for item in items %}{{ item }}{% endfor %}')
      expect(variables).toEqual(new Set(['items']))
    })

    it('should extract iterable with tuple unpacking {% for key, value in data.items() %}', () => {
      const { variables } = extractTemplateVariables(
        '{% for key, value in data.items() %}{{ key }}: {{ value }}{% endfor %}'
      )
      expect(variables).toEqual(new Set(['data']))
    })

    it('should extract iterable from nested loop', () => {
      const { variables } = extractTemplateVariables(
        '{% for row in rows %}{% for cell in row.cells %}{{ cell }}{% endfor %}{% endfor %}'
      )
      // 'rows' is iterable, 'row' is loop var, 'row.cells' is nested - 'row' is local
      expect(variables).toEqual(new Set(['rows']))
    })

    it('should handle for-else construct', () => {
      const { variables } = extractTemplateVariables(
        '{% for item in items %}{{ item }}{% else %}No items{% endfor %}'
      )
      expect(variables).toEqual(new Set(['items']))
    })

    it('should not capture loop variable used inside loop body', () => {
      const { variables } = extractTemplateVariables(
        '{% for user in users %}Name: {{ user.name }}{% endfor %}'
      )
      expect(variables).toEqual(new Set(['users']))
      expect(variables.has('user')).toBe(false)
    })
  })

  describe('conditionals - basic', () => {
    it('should extract variable from simple {% if var %}', () => {
      const { variables } = extractTemplateVariables('{% if active %}Yes{% endif %}')
      expect(variables).toEqual(new Set(['active']))
    })

    it('should extract variable from {% if var.prop %}', () => {
      const { variables } = extractTemplateVariables('{% if user.is_admin %}Admin{% endif %}')
      expect(variables).toEqual(new Set(['user']))
    })

    it('should extract variable from elif', () => {
      const { variables } = extractTemplateVariables(
        '{% if a %}A{% elif b %}B{% else %}C{% endif %}'
      )
      expect(variables).toEqual(new Set(['a', 'b']))
    })
  })

  describe('conditionals - keywords (not, and, or)', () => {
    it('should extract user from {% if not user %}, ignoring "not"', () => {
      const { variables } = extractTemplateVariables('{% if not user %}Guest{% endif %}')
      expect(variables).toEqual(new Set(['user']))
      expect(variables.has('not')).toBe(false)
    })

    it('should extract both variables from {% if user and team %}', () => {
      const { variables } = extractTemplateVariables('{% if user and team %}Both{% endif %}')
      expect(variables).toEqual(new Set(['user', 'team']))
    })

    it('should extract both variables from {% if user or guest %}', () => {
      const { variables } = extractTemplateVariables('{% if user or guest %}Someone{% endif %}')
      expect(variables).toEqual(new Set(['user', 'guest']))
    })

    it('should handle complex boolean expression', () => {
      const { variables } = extractTemplateVariables(
        '{% if (user and team) or (guest and not restricted) %}Access{% endif %}'
      )
      expect(variables).toEqual(new Set(['user', 'team', 'guest', 'restricted']))
    })

    it('should handle not with dotted access {% if not user.is_banned %}', () => {
      const { variables } = extractTemplateVariables('{% if not user.is_banned %}OK{% endif %}')
      expect(variables).toEqual(new Set(['user']))
    })
  })

  describe('conditionals - comparisons', () => {
    it('should extract variables from comparison {% if count > 0 %}', () => {
      const { variables } = extractTemplateVariables('{% if count > 0 %}Has items{% endif %}')
      expect(variables).toEqual(new Set(['count']))
    })

    it('should extract variables from equality check {% if status == "active" %}', () => {
      const { variables } = extractTemplateVariables('{% if status == "active" %}Active{% endif %}')
      expect(variables).toEqual(new Set(['status']))
    })

    it('should extract variables from both sides of comparison', () => {
      const { variables } = extractTemplateVariables('{% if user_count > min_users %}OK{% endif %}')
      expect(variables).toEqual(new Set(['user_count', 'min_users']))
    })

    it('should handle "in" operator', () => {
      const { variables } = extractTemplateVariables('{% if role in allowed_roles %}OK{% endif %}')
      expect(variables).toEqual(new Set(['role', 'allowed_roles']))
    })
  })

  describe('conditionals - is tests', () => {
    it('should extract variable from {% if var is defined %}', () => {
      const { variables } = extractTemplateVariables('{% if name is defined %}{{ name }}{% endif %}')
      expect(variables).toEqual(new Set(['name']))
      expect(variables.has('defined')).toBe(false)
    })

    it('should extract variable from {% if var is not none %}', () => {
      const { variables } = extractTemplateVariables('{% if value is not none %}{{ value }}{% endif %}')
      expect(variables).toEqual(new Set(['value']))
      expect(variables.has('none')).toBe(false)
    })
  })

  describe('inline conditionals (ternary)', () => {
    it('should extract variables from {{ "yes" if condition else "no" }}', () => {
      const { variables } = extractTemplateVariables('{{ "yes" if active else "no" }}')
      expect(variables).toEqual(new Set(['active']))
    })

    it('should extract variables from all parts of ternary', () => {
      const { variables } = extractTemplateVariables('{{ value1 if condition else value2 }}')
      expect(variables).toEqual(new Set(['value1', 'condition', 'value2']))
    })
  })

  describe('set statements', () => {
    it('should not capture variable defined with {% set %}', () => {
      const { variables } = extractTemplateVariables(
        '{% set x = 5 %}{{ x }}'
      )
      // x is defined locally via set, so it shouldn't be in the result
      expect(variables.has('x')).toBe(false)
    })

    it('should extract variables used in set value', () => {
      const { variables } = extractTemplateVariables(
        '{% set total = price * quantity %}{{ total }}'
      )
      expect(variables).toContain('price')
      expect(variables).toContain('quantity')
    })
  })

  describe('built-in variables and functions', () => {
    it('should not capture "loop" as a variable', () => {
      const { variables } = extractTemplateVariables(
        '{% for item in items %}{{ loop.index }}: {{ item }}{% endfor %}'
      )
      expect(variables).toEqual(new Set(['items']))
      expect(variables.has('loop')).toBe(false)
    })

    it('should not capture "range" as a variable', () => {
      const { variables } = extractTemplateVariables(
        '{% for i in range(10) %}{{ i }}{% endfor %}'
      )
      expect(variables).toEqual(new Set())
      expect(variables.has('range')).toBe(false)
    })

    it('should not capture "true" or "false" as variables', () => {
      const { variables } = extractTemplateVariables('{% if condition == true %}{% endif %}')
      expect(variables).toEqual(new Set(['condition']))
      expect(variables.has('true')).toBe(false)
    })
  })

  describe('complex templates', () => {
    it('should handle a real-world template with multiple features', () => {
      const template = `
# Report for {{ title }}

{% if show_summary %}
## Summary
{{ summary | truncate(200) }}
{% endif %}

{% for item in items %}
### {{ item.name }}
{{ item.description }}

{% if item.details and show_details %}
Details: {{ item.details }}
{% endif %}
{% endfor %}

{% if not items %}
No items found.
{% endif %}

Generated: {{ timestamp | date }}
`
      const { variables } = extractTemplateVariables(template)
      expect(variables).toEqual(new Set([
        'title',
        'show_summary',
        'summary',
        'items',
        'show_details',
        'timestamp',
      ]))
    })

    it('should handle template with macros', () => {
      const template = `
{% macro input(name, value="", type="text") %}
<input type="{{ type }}" name="{{ name }}" value="{{ value }}">
{% endmacro %}

{{ input("username", user.name) }}
`
      const { variables } = extractTemplateVariables(template)
      // Macro parameters are local, user is external
      expect(variables).toContain('user')
    })
  })

  describe('error handling', () => {
    it('should return error for invalid template syntax', () => {
      const { variables, error } = extractTemplateVariables('{% if unclosed')
      expect(error).toBeDefined()
      expect(variables).toEqual(new Set())
    })

    it('should return error for mismatched tags', () => {
      const { variables, error } = extractTemplateVariables('{% if x %}{% endfor %}')
      expect(error).toBeDefined()
      expect(variables).toEqual(new Set())
    })

    it('should handle template with only static content (no error)', () => {
      const { variables, error } = extractTemplateVariables('Hello World!')
      expect(error).toBeUndefined()
      expect(variables).toEqual(new Set())
    })
  })

  describe('edge cases', () => {
    it('should handle escaped braces', () => {
      // In Jinja2, raw block prevents parsing
      const { variables } = extractTemplateVariables('{% raw %}{{ not_a_var }}{% endraw %}')
      expect(variables).toEqual(new Set())
    })

    it('should handle comments', () => {
      const { variables } = extractTemplateVariables('{# {{ commented_var }} #}{{ real_var }}')
      expect(variables).toEqual(new Set(['real_var']))
      expect(variables.has('commented_var')).toBe(false)
    })

    it('should handle whitespace control syntax', () => {
      const { variables } = extractTemplateVariables('{{- name -}}')
      expect(variables).toEqual(new Set(['name']))
    })

    it('should handle block tag whitespace control', () => {
      const { variables } = extractTemplateVariables('{%- if condition -%}yes{%- endif -%}')
      expect(variables).toEqual(new Set(['condition']))
    })
  })
})
