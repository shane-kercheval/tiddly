"""Pydantic schemas for prompts."""
from datetime import datetime
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PromptArgument(BaseModel):
    """Single prompt argument definition."""

    name: str = Field(
        pattern=r"^[a-z][a-z0-9_]*$",
        max_length=100,
        description="Argument name (lowercase, underscores allowed, must start with letter)",
    )
    description: str | None = Field(
        default=None,
        description="Description of the argument",
    )
    required: bool | None = Field(
        default=None,
        description="Whether this argument is required (None treated as False)",
    )


class PromptCreate(BaseModel):
    """Request body for creating a prompt."""

    name: str = Field(
        min_length=1,
        max_length=255,
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Prompt identifier (lowercase with hyphens, e.g., 'code-review')",
    )
    title: str | None = Field(
        default=None,
        max_length=500,
        description="Optional display title (e.g., 'Code Review Assistant')",
    )
    description: str | None = Field(
        default=None,
        description="Optional description",
    )
    content: str | None = Field(
        default=None,
        description="Jinja2 template content",
    )
    arguments: list[PromptArgument] = Field(
        default_factory=list,
        description="List of prompt arguments",
    )

    @model_validator(mode="after")
    def validate_arguments(self) -> Self:
        """Validate argument names are unique."""
        if self.arguments:
            names = [arg.name for arg in self.arguments]
            if len(names) != len(set(names)):
                duplicates = [n for n in names if names.count(n) > 1]
                raise ValueError(
                    f"Duplicate argument names: {', '.join(set(duplicates))}",
                )
        return self


class PromptUpdate(BaseModel):
    """Request body for updating a prompt."""

    name: str | None = Field(
        default=None,
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        max_length=255,
        description="New name (renames the prompt)",
    )
    title: str | None = Field(
        default=None,
        max_length=500,
        description="Display title",
    )
    description: str | None = None
    content: str | None = None
    arguments: list[PromptArgument] | None = None

    @model_validator(mode="after")
    def validate_arguments(self) -> Self:
        """Validate argument names are unique if provided."""
        if self.arguments:
            names = [arg.name for arg in self.arguments]
            if len(names) != len(set(names)):
                duplicates = [n for n in names if names.count(n) > 1]
                raise ValueError(
                    f"Duplicate argument names: {', '.join(set(duplicates))}",
                )
        return self


class PromptResponse(BaseModel):
    """Response for a prompt."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    title: str | None
    description: str | None
    content: str | None
    arguments: list[PromptArgument]
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def convert_arguments(cls, data: Any) -> Any:
        """Convert arguments from JSONB dicts to PromptArgument objects."""
        # Handle SQLAlchemy model objects
        if hasattr(data, "__dict__"):
            data_dict = {}
            for key in ["id", "name", "title", "description", "content",
                        "arguments", "created_at", "updated_at"]:
                if hasattr(data, key):
                    data_dict[key] = getattr(data, key)
            return data_dict
        return data


class PromptListResponse(BaseModel):
    """Response for listing prompts."""

    items: list[PromptResponse]
    total: int
