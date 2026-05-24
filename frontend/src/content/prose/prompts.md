---
route: /docs/features/prompts
title: Docs - Prompts & Templates
description: Prompt templates are Jinja2 templates with typed arguments — covers variables, conditionals, filters, loops, editor slash commands, rendering via MCP or API, and agent skills.
---

# Prompts & Templates

Prompts are Jinja2 templates with typed arguments. Define reusable templates for AI assistants, render them with different values, and access them programmatically via MCP or the API.

## Template Basics

Use `{{ variable_name }}` to create placeholders that get filled in when the template is rendered:

```jinja
Review this {{ language }} code for bugs and improvements:

{{ code_to_review }}
```

Arguments are automatically detected from your template content — when you add or remove a `{{ }}` variable, the arguments list updates to match.

## Arguments

Each argument has a name, optional description, and required flag:

- **Name** — valid Jinja2 identifier (lowercase, underscores). Must match the variable in the template.
- **Description** — explains what value to provide. Shown to AI assistants via MCP.
- **Required** — required arguments must be supplied at render time; optional ones default to empty string.

> [!tip]
> Write clear argument descriptions — AI assistants see them when deciding what values to pass, so good descriptions lead to better results.

## Jinja2 Syntax

Templates support the full Jinja2 syntax. Here are the most useful features:

### Variables

```jinja
{{ variable_name }}
```

### Conditionals

Include sections only when an argument is provided:

```jinja
{% if context %}
Context: {{ context }}
{% endif %}
```

### Whitespace Control

Add a `-` to strip whitespace around blocks (keeps output clean when optional sections are empty):

```jinja
{%- if style_guide %}
Follow this style guide: {{ style_guide }}
{%- endif %}
```

### Filters

Transform values with pipe filters:

```jinja
{{ name | upper }}
{{ items | join(", ") }}
{{ text | default("No text provided") }}
```

### Loops

```jinja
{% for item in items %}
- {{ item }}
{% endfor %}
```

## Editor Slash Commands

The prompt editor includes Jinja2-specific slash commands. Type `/` at the start of a line to see:

- **Variable** — inserts `{{ }}`
- **If block** — inserts a conditional block
- **If block (trim)** — inserts a conditional with whitespace trimming

## Rendering

Templates are rendered by supplying values for the arguments. This happens in two ways:

- **Via MCP** — AI assistants fetch and render your templates through the Prompt MCP server. See [AI Integration](/docs/ai).
- **Via API** — call `POST /prompts/{id}/render` with argument values. See [API docs](/docs/api).

> [!info]
> Templates use strict mode — referencing an undefined variable raises an error rather than silently producing empty output. This catches typos and missing arguments early.

## Agent Skills

Prompts can be exported as **agent skills** — instruction files that AI assistants can use automatically or on demand. Depending on the client, skills may be auto-invoked based on context, triggered via slash command, or called through natural language. Tag a prompt with `skill` and sync it to your project to get started.

See the [AI Integration](/docs/ai) docs for setup instructions, or use the [CLI](/docs/cli/skills) for quick sync.
