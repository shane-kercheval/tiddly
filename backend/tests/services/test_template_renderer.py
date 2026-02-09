"""Tests for template renderer."""

import pytest

from services.template_renderer import TemplateError, render_template


def test__render_template__simple_substitution() -> None:
    """Test basic variable substitution."""
    content = "Hello, {{ name }}!"
    args = [{"name": "name", "required": True}]
    result = render_template(content, {"name": "World"}, args)
    assert result == "Hello, World!"


def test__render_template__multiple_variables() -> None:
    """Test template with multiple variables."""
    content = "{{ greeting }}, {{ name }}! Welcome to {{ place }}."
    args = [
        {"name": "greeting", "required": True},
        {"name": "name", "required": True},
        {"name": "place", "required": True},
    ]
    result = render_template(
        content,
        {"greeting": "Hello", "name": "Alice", "place": "Python"},
        args,
    )
    assert result == "Hello, Alice! Welcome to Python."


def test__render_template__empty_content_returns_empty_string() -> None:
    """Test that empty content returns empty string."""
    assert render_template("", None, []) == ""
    assert render_template(None, None, []) == ""


def test__render_template__no_arguments_no_variables() -> None:
    """Test template with no variables."""
    content = "This is a static prompt."
    result = render_template(content, None, [])
    assert result == "This is a static prompt."


def test__render_template__complex_jinja_logic() -> None:
    """Test template with Jinja2 control structures."""
    content = "{% if formal %}Dear {{ name }},{% else %}Hey {{ name }}!{% endif %}"
    args = [
        {"name": "name", "required": True},
        {"name": "formal", "required": False},
    ]

    # With formal=true
    result = render_template(content, {"name": "Bob", "formal": "true"}, args)
    assert result == "Dear Bob,"

    # With formal=false (empty string is falsy)
    result = render_template(content, {"name": "Bob", "formal": ""}, args)
    assert result == "Hey Bob!"


def test__render_template__missing_required_argument_error() -> None:
    """Test error when required argument is missing."""
    content = "Hello, {{ name }}!"
    args = [{"name": "name", "required": True}]

    with pytest.raises(TemplateError, match="Missing required argument.*name"):
        render_template(content, {}, args)


def test__render_template__multiple_missing_required_arguments() -> None:
    """Test error lists all missing required arguments."""
    content = "{{ a }} {{ b }} {{ c }}"
    args = [
        {"name": "a", "required": True},
        {"name": "b", "required": True},
        {"name": "c", "required": True},
    ]

    with pytest.raises(TemplateError, match="Missing required argument.*a.*b.*c"):
        render_template(content, {}, args)


def test__render_template__unknown_argument_error() -> None:
    """Test error when unknown argument is provided."""
    content = "Hello, {{ name }}!"
    args = [{"name": "name", "required": True}]

    with pytest.raises(TemplateError, match="Unknown argument.*extra"):
        render_template(content, {"name": "World", "extra": "value"}, args)


def test__render_template__unknown_argument_lists_valid() -> None:
    """Test error message includes valid arguments."""
    content = "Hello!"
    args = [{"name": "valid_arg", "required": False}]

    with pytest.raises(TemplateError, match="Valid arguments: valid_arg"):
        render_template(content, {"invalid": "value"}, args)


def test__render_template__optional_argument_can_be_omitted() -> None:
    """Test that optional arguments can be omitted."""
    content = "{% if style %}Style: {{ style }}{% else %}No style{% endif %}"
    args = [{"name": "style", "required": False}]

    result = render_template(content, {}, args)
    assert result == "No style"


def test__render_template__optional_argument_can_be_provided() -> None:
    """Test that optional arguments can be provided."""
    content = "{% if style %}Style: {{ style }}{% else %}No style{% endif %}"
    args = [{"name": "style", "required": False}]

    result = render_template(content, {"style": "formal"}, args)
    assert result == "Style: formal"


def test__render_template__syntax_error() -> None:
    """Test error on invalid Jinja2 syntax."""
    content = "Hello, {{ unclosed"
    args: list = []

    with pytest.raises(TemplateError, match="Template syntax error"):
        render_template(content, {}, args)


def test__render_template__undefined_variable_in_template() -> None:
    """Test error when template uses undefined variable."""
    # This can happen if the template has a typo
    content = "Hello, {{ naem }}!"  # Typo: naem instead of name
    args = [{"name": "name", "required": True}]

    # StrictUndefined will catch this at render time
    with pytest.raises(TemplateError, match="Template variable error"):
        render_template(content, {"name": "World"}, args)


def test__render_template__required_none_treated_as_false() -> None:
    """Test that required=None is treated as not required."""
    content = "Hello{% if name %}, {{ name }}{% endif %}!"
    args = [{"name": "name", "required": None}]

    # Should not raise - None means not required
    result = render_template(content, {}, args)
    assert result == "Hello!"


def test__render_template__with_filters() -> None:
    """Test template with Jinja2 filters."""
    content = "{{ name | upper }}"
    args = [{"name": "name", "required": True}]

    result = render_template(content, {"name": "hello"}, args)
    assert result == "HELLO"


def test__render_template__for_loop() -> None:
    """Test template with {% for %} loop."""
    content = "{% for item in items %}{{ item }} {% endfor %}"
    args = [{"name": "items", "required": True}]

    result = render_template(content, {"items": ["a", "b", "c"]}, args)
    assert result == "a b c "


def test__render_template__for_loop_with_loop_variable() -> None:
    """Test template using the 'loop' special variable."""
    content = "{% for item in items %}{{ loop.index }}.{{ item }} {% endfor %}"
    args = [{"name": "items", "required": True}]

    result = render_template(content, {"items": ["x", "y"]}, args)
    assert result == "1.x 2.y "


def test__render_template__for_loop_with_loop_last() -> None:
    """Test template using loop.last to detect last iteration."""
    content = "{% for item in items %}{{ item }}{% if not loop.last %}, {% endif %}{% endfor %}"
    args = [{"name": "items", "required": True}]

    result = render_template(content, {"items": ["a", "b", "c"]}, args)
    assert result == "a, b, c"


def test__render_template__nested_conditionals_and_loops() -> None:
    """Test complex template with nested control structures."""
    content = """{% for item in items %}{% if item.active %}[{{ item.name }}]{% endif %}{% endfor %}"""
    args = [{"name": "items", "required": True}]

    items = [
        {"name": "A", "active": True},
        {"name": "B", "active": False},
        {"name": "C", "active": True},
    ]
    result = render_template(content, {"items": items}, args)
    assert result == "[A][C]"
