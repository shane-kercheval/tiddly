"""Tests for skill_converter module."""

from unittest.mock import MagicMock

import yaml

from services.skill_converter import (
    CLIENT_CONSTRAINTS,
    ClientType,
    SkillExport,
    prompt_to_skill_md,
)


def _create_mock_prompt(
    name: str = "test-prompt",
    title: str | None = "Test Title",
    description: str | None = "Test description",
    content: str | None = "Test content",
    arguments: list[dict] | None = None,
) -> MagicMock:
    """Create a mock Prompt object for testing."""
    mock = MagicMock()
    mock.name = name
    mock.title = title
    mock.description = description
    mock.content = content
    mock.arguments = arguments if arguments is not None else []
    return mock


# =============================================================================
# Basic Conversion Tests
# =============================================================================


def test__prompt_to_skill_md__basic_conversion() -> None:
    """Test basic conversion with all fields populated."""
    prompt = _create_mock_prompt(
        name="code-review",
        title="Code Review",
        description="Review code for issues",
        content="Review the following code:\n\n{{ code }}",
        arguments=[
            {"name": "code", "description": "The code to review", "required": True},
            {"name": "language", "description": "Programming language", "required": False},
        ],
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    assert isinstance(result, SkillExport)
    assert result.directory_name == "code-review"
    assert "---" in result.content  # Has frontmatter
    assert "name: code-review" in result.content
    assert "## Instructions" in result.content
    assert "Review the following code:" in result.content
    assert "{{ code }}" in result.content


def test__prompt_to_skill_md__required_and_optional_arguments() -> None:
    """Verify 'Requires:' and 'Optional:' appear in description."""
    prompt = _create_mock_prompt(
        name="test",
        description="Base description",
        arguments=[
            {"name": "required_arg", "required": True},
            {"name": "optional_arg", "required": False},
        ],
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    # Parse YAML frontmatter to check description
    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert "Requires: required_arg." in parsed["description"]
    assert "Optional: optional_arg." in parsed["description"]


def test__prompt_to_skill_md__template_variables_section() -> None:
    """Verify Template Variables section lists variables with {{ name }} syntax."""
    prompt = _create_mock_prompt(
        name="test",
        arguments=[
            {"name": "code", "description": "The code", "required": True},
            {"name": "lang", "description": "Language", "required": False},
        ],
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    assert "## Template Variables" in result.content
    assert "{{ code }}" in result.content
    assert "(required): The code" in result.content
    assert "{{ lang }}" in result.content
    assert "(optional): Language" in result.content


def test__prompt_to_skill_md__no_arguments() -> None:
    """Prompt without arguments has no Template Variables section."""
    prompt = _create_mock_prompt(
        name="simple",
        description="Simple prompt",
        arguments=[],
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    assert "## Template Variables" not in result.content
    # Description should not have Requires/Optional
    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert "Requires:" not in parsed["description"]
    assert "Optional:" not in parsed["description"]


def test__prompt_to_skill_md__no_description_uses_title() -> None:
    """Falls back to title when description is None."""
    prompt = _create_mock_prompt(
        name="test",
        title="Fallback Title",
        description=None,
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert parsed["description"] == "Fallback Title"


def test__prompt_to_skill_md__no_title_or_description_uses_generic() -> None:
    """Uses generic 'Skill: {name}' when both title and description are None."""
    prompt = _create_mock_prompt(
        name="my-skill",
        title=None,
        description=None,
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert parsed["description"] == "Skill: my-skill"


def test__prompt_to_skill_md__no_content() -> None:
    """Handles None content gracefully with empty Instructions section."""
    prompt = _create_mock_prompt(
        name="empty",
        content=None,
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    assert "## Instructions" in result.content
    # Content should end with just the Instructions header and newline
    assert result.content.endswith("## Instructions\n\n\n")


def test__prompt_to_skill_md__jinja2_preserved() -> None:
    """Template syntax is preserved in output."""
    prompt = _create_mock_prompt(
        name="jinja-test",
        content="{% if debug %}DEBUG MODE{% endif %}\n{{ value | upper }}",
        arguments=[
            {"name": "debug", "required": False},
            {"name": "value", "required": True},
        ],
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    assert "{% if debug %}" in result.content
    assert "{% endif %}" in result.content
    assert "{{ value | upper }}" in result.content


def test__prompt_to_skill_md__yaml_frontmatter_valid() -> None:
    """Output starts with valid YAML frontmatter."""
    prompt = _create_mock_prompt(name="valid-yaml")

    result = prompt_to_skill_md(prompt, "claude-code")

    # Should start with ---
    assert result.content.startswith("---\n")

    # Parse and validate frontmatter
    lines = result.content.split("\n")
    frontmatter_end = lines.index("---", 1)
    frontmatter_text = "\n".join(lines[1:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert "name" in parsed
    assert "description" in parsed


# =============================================================================
# Name Truncation Tests
# =============================================================================


def test__prompt_to_skill_md__name_truncation_claude_code() -> None:
    """Name >64 chars truncated to 64 for claude-code."""
    long_name = "a" * 80  # 80 chars
    prompt = _create_mock_prompt(name=long_name)

    result = prompt_to_skill_md(prompt, "claude-code")

    assert len(result.directory_name) == 64
    assert result.directory_name == "a" * 64

    # Verify frontmatter name also truncated
    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert len(parsed["name"]) == 64


def test__prompt_to_skill_md__name_truncation_codex() -> None:
    """Name >100 chars truncated to 100 for codex."""
    long_name = "b" * 120  # 120 chars
    prompt = _create_mock_prompt(name=long_name)

    result = prompt_to_skill_md(prompt, "codex")

    assert len(result.directory_name) == 100
    assert result.directory_name == "b" * 100


# =============================================================================
# Description Truncation Tests
# =============================================================================


def test__prompt_to_skill_md__description_truncation_claude_code() -> None:
    """Description >1024 chars truncated for claude-code."""
    long_desc = "x" * 1500
    prompt = _create_mock_prompt(name="test", description=long_desc)

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert len(parsed["description"]) == 1024


def test__prompt_to_skill_md__description_truncation_codex() -> None:
    """Description >500 chars truncated for codex."""
    long_desc = "y" * 800
    prompt = _create_mock_prompt(name="test", description=long_desc)

    result = prompt_to_skill_md(prompt, "codex")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert len(parsed["description"]) == 500


def test__prompt_to_skill_md__description_single_line_codex() -> None:
    """Multi-line description collapsed to single line for codex."""
    multi_line_desc = "Line one\nLine two\n\nLine three\twith tab"
    prompt = _create_mock_prompt(name="test", description=multi_line_desc)

    result = prompt_to_skill_md(prompt, "codex")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    # No newlines, tabs, or multiple spaces
    assert "\n" not in parsed["description"]
    assert "\t" not in parsed["description"]
    assert "  " not in parsed["description"]
    assert parsed["description"] == "Line one Line two Line three with tab"


def test__prompt_to_skill_md__description_multiline_claude_code() -> None:
    """Multi-line description preserved for claude-code."""
    multi_line_desc = "Line one\nLine two"
    prompt = _create_mock_prompt(name="test", description=multi_line_desc)

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert parsed["description"] == "Line one\nLine two"


# =============================================================================
# YAML Escaping Tests
# =============================================================================


def test__prompt_to_skill_md__yaml_escaping_colon() -> None:
    """Description with : character produces valid YAML."""
    prompt = _create_mock_prompt(
        name="test",
        description="Key: value and more: stuff",
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    # Should be parseable
    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert "Key: value and more: stuff" in parsed["description"]


def test__prompt_to_skill_md__yaml_escaping_hash() -> None:
    """Description with # character is not treated as comment."""
    prompt = _create_mock_prompt(
        name="test",
        description="Use #hashtag in description",
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert "#hashtag" in parsed["description"]


def test__prompt_to_skill_md__yaml_escaping_quotes() -> None:
    """Description with quotes produces valid YAML."""
    prompt = _create_mock_prompt(
        name="test",
        description='Use "double" and \'single\' quotes',
    )

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert '"double"' in parsed["description"]
    assert "'single'" in parsed["description"]


# =============================================================================
# Directory Name Tests
# =============================================================================


def test__prompt_to_skill_md__directory_name_matches_frontmatter() -> None:
    """Verify directory_name equals name in frontmatter."""
    prompt = _create_mock_prompt(name="my-skill")

    result = prompt_to_skill_md(prompt, "claude-code")

    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert result.directory_name == parsed["name"]


def test__prompt_to_skill_md__directory_name_truncated() -> None:
    """80-char prompt name -> 64-char directory for claude-code."""
    long_name = "x" * 80
    prompt = _create_mock_prompt(name=long_name)

    result = prompt_to_skill_md(prompt, "claude-code")

    assert len(result.directory_name) == 64

    # Verify it matches frontmatter
    lines = result.content.split("\n")
    frontmatter_start = lines.index("---") + 1
    frontmatter_end = lines.index("---", frontmatter_start)
    frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
    parsed = yaml.safe_load(frontmatter_text)

    assert result.directory_name == parsed["name"]


# =============================================================================
# Client Constraints Verification
# =============================================================================


def test__client_constraints__all_clients_defined() -> None:
    """Verify all client types have constraint definitions."""
    expected_clients: list[ClientType] = ["claude-code", "claude-desktop", "codex"]

    for client in expected_clients:
        assert client in CLIENT_CONSTRAINTS
        assert "name_max" in CLIENT_CONSTRAINTS[client]
        assert "desc_max" in CLIENT_CONSTRAINTS[client]
        assert "desc_single_line" in CLIENT_CONSTRAINTS[client]


def test__prompt_to_skill_md__claude_desktop_same_as_claude_code() -> None:
    """claude-desktop uses same constraints as claude-code."""
    prompt = _create_mock_prompt(
        name="a" * 80,
        description="b" * 1500,
    )

    code_result = prompt_to_skill_md(prompt, "claude-code")
    desktop_result = prompt_to_skill_md(prompt, "claude-desktop")

    assert len(code_result.directory_name) == len(desktop_result.directory_name) == 64

    # Parse both frontmatters
    for result in [code_result, desktop_result]:
        lines = result.content.split("\n")
        frontmatter_start = lines.index("---") + 1
        frontmatter_end = lines.index("---", frontmatter_start)
        frontmatter_text = "\n".join(lines[frontmatter_start:frontmatter_end])
        parsed = yaml.safe_load(frontmatter_text)
        assert len(parsed["description"]) == 1024
