"""
Jinja2 template rendering with strict validation.

Renders prompt templates with user-provided arguments,
validating that required arguments are present and
rejecting unknown arguments.
"""

from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateSyntaxError, UndefinedError


class TemplateError(Exception):
    """Raised when template rendering fails."""

    pass


# Jinja2 environment with strict undefined variable handling
_jinja_env = Environment(undefined=StrictUndefined)


def render_template(
    content: str | None,
    arguments: dict[str, Any] | None,
    defined_args: list[dict[str, Any]],
) -> str:
    """
    Render a Jinja2 template with argument validation.

    Args:
        content: The Jinja2 template content. Returns empty string if None.
        arguments: User-provided argument values. Keys are argument names.
        defined_args: List of argument definitions from the prompt.
            Each dict has 'name', 'description', and 'required' keys.

    Returns:
        The rendered template string.

    Raises:
        TemplateError: If required arguments are missing, unknown arguments
            are provided, or template rendering fails.
    """
    if not content:
        return ""

    arguments = arguments or {}

    # Build set of defined argument names
    defined_names = {arg["name"] for arg in defined_args}

    # Check for unknown arguments
    unknown = set(arguments.keys()) - defined_names
    if unknown:
        raise TemplateError(
            f"Unknown argument(s): {', '.join(sorted(unknown))}. "
            f"Valid arguments: {', '.join(sorted(defined_names)) if defined_names else 'none'}",
        )

    # Check for missing required arguments
    required_names = {
        arg["name"] for arg in defined_args if arg.get("required") is True
    }
    missing = required_names - set(arguments.keys())
    if missing:
        raise TemplateError(
            f"Missing required argument(s): {', '.join(sorted(missing))}",
        )

    # Provide default empty string for optional arguments not provided
    # This allows {% if var %} conditions to work correctly with StrictUndefined
    render_args = dict(arguments)
    for arg in defined_args:
        if arg["name"] not in render_args:
            render_args[arg["name"]] = ""

    # Render template
    try:
        template = _jinja_env.from_string(content)
        return template.render(**render_args)
    except TemplateSyntaxError as e:
        raise TemplateError(f"Template syntax error: {e.message}") from e
    except UndefinedError as e:
        raise TemplateError(f"Template variable error: {e}") from e
