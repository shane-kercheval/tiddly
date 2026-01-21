"""
Error response schemas for API endpoints.

Provides structured error responses for OpenAPI documentation and consistent
error handling across the API. Also includes str-replace request/response schemas.
"""
from datetime import datetime
from typing import Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from schemas.content_search import ContentSearchMatch
from schemas.prompt import PromptArgument
from schemas.validators import check_duplicate_argument_names


class StrReplaceRequest(BaseModel):
    """Request body for str-replace operations (notes and bookmarks)."""

    old_str: str = Field(
        min_length=1,
        description="Exact text to find (include 3-5 lines of surrounding context for uniqueness)",
    )
    new_str: str = Field(
        description="Replacement text (use empty string to delete)",
    )


class PromptStrReplaceRequest(BaseModel):
    """
    Request body for str-replace operations on prompts.

    Supports optional `arguments` field for atomic content + arguments updates.
    This solves the chicken-and-egg problem where adding/removing template variables
    requires updating both content and arguments together.
    """

    old_str: str = Field(
        min_length=1,
        description="Exact text to find (include 3-5 lines of surrounding context for uniqueness)",
    )
    new_str: str = Field(
        description="Replacement text (use empty string to delete)",
    )
    arguments: list[PromptArgument] | None = Field(
        default=None,
        description="Optional: Replace ALL arguments atomically with content update. "
        "If omitted, validation uses existing arguments. "
        "If provided, this list fully replaces current arguments (not a merge). "
        "Use this when adding/removing template variables to avoid validation errors.",
    )

    @model_validator(mode="after")
    def check_duplicate_arguments(self) -> "PromptStrReplaceRequest":
        """Ensure no duplicate argument names if arguments provided."""
        check_duplicate_argument_names(self.arguments)
        return self


class ContentEmptyError(BaseModel):
    """Error response when entity has no content to edit."""

    error: Literal["content_empty"] = Field(
        default="content_empty",
        description="Error type identifier",
    )
    message: str = Field(
        description="Human-readable error message describing which entity has no content",
    )
    suggestion: str = Field(
        default="Use PATCH to set content before attempting str-replace",
        description="Suggested action to resolve the error",
    )


class StrReplaceNoMatchError(BaseModel):
    """Error response when old_str is not found in content."""

    error: Literal["no_match"] = Field(
        default="no_match",
        description="Error type identifier",
    )
    message: str = Field(
        default="The specified text was not found in the content",
        description="Human-readable error message",
    )
    suggestion: str = Field(
        default="Verify the text exists and check for whitespace differences",
        description="Suggested action to resolve the error",
    )


class StrReplaceMultipleMatchesError(BaseModel):
    """Error response when old_str matches multiple locations."""

    error: Literal["multiple_matches"] = Field(
        default="multiple_matches",
        description="Error type identifier",
    )
    matches: list[ContentSearchMatch] = Field(
        description="List of all matches with line numbers and context",
    )
    suggestion: str = Field(
        default="Include more surrounding context to ensure uniqueness",
        description="Suggested action to resolve the error",
    )


# Generic type for entity responses (NoteResponse, BookmarkResponse, PromptResponse)
T = TypeVar("T")


class StrReplaceSuccess(BaseModel, Generic[T]):
    """
    Success response for str-replace operations (full entity).

    Contains metadata about the match that was replaced, plus the full
    updated entity in the `data` field. Use `include_updated_entity=true`
    query param to get this response.
    """

    response_type: Literal["full"] = Field(
        default="full",
        description="Discriminator field indicating full entity response",
    )
    match_type: Literal["exact", "whitespace_normalized"] = Field(
        description="Which matching strategy succeeded: "
        "'exact' for character-for-character match, "
        "'whitespace_normalized' for match after normalizing line endings and trailing whitespace",
    )
    line: int = Field(
        description="Line number (1-indexed) where the match was found",
    )
    data: T = Field(
        description="The full updated entity (NoteResponse, BookmarkResponse, or PromptResponse)",
    )


class MinimalEntityData(BaseModel):
    """Minimal entity data for str-replace responses (default)."""

    id: UUID = Field(description="Entity ID")
    updated_at: datetime = Field(description="Timestamp of the update")


class StrReplaceSuccessMinimal(BaseModel):
    """
    Success response for str-replace operations (minimal, default).

    Contains metadata about the match that was replaced, plus minimal
    entity data (id and updated_at only). This is the default response
    to reduce bandwidth and token usage for LLMs.
    """

    response_type: Literal["minimal"] = Field(
        default="minimal",
        description="Discriminator field indicating minimal response",
    )
    match_type: Literal["exact", "whitespace_normalized"] = Field(
        description="Which matching strategy succeeded: "
        "'exact' for character-for-character match, "
        "'whitespace_normalized' for match after normalizing line endings and trailing whitespace",
    )
    line: int = Field(
        description="Line number (1-indexed) where the match was found",
    )
    data: MinimalEntityData = Field(
        description="Minimal entity data with id and updated_at",
    )
