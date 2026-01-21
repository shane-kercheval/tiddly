"""Pydantic schemas for within-content search endpoints."""
from pydantic import BaseModel, Field


class ContentSearchMatch(BaseModel):
    """A single match within a content item's field."""

    field: str = Field(
        description="The field where the match was found (content, title, description)",
    )
    line: int | None = Field(
        description="Line number (1-indexed) for content field matches, null for other fields",
    )
    context: str = Field(
        description="Surrounding context: for content field, includes context_lines before/after; "
        "for title/description, the full field value",
    )


class ContentSearchResponse(BaseModel):
    """Response from within-content search endpoint."""

    matches: list[ContentSearchMatch] = Field(
        description="List of matches found. Empty array if no matches (not an error).",
    )
    total_matches: int = Field(description="Total number of matches found")
