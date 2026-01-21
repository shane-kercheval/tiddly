"""Shared content metadata schema for partial reads."""
from pydantic import BaseModel, Field


class ContentMetadata(BaseModel):
    """
    Metadata about content field in responses.

    Included whenever content is non-null. Provides line count information
    and indicates whether the response contains partial or full content.
    """

    total_lines: int = Field(
        description="Total number of lines in the full content. "
        "Counted using len(content.split('\\n')).",
    )
    start_line: int = Field(
        description="First line number in the returned content (1-indexed).",
    )
    end_line: int = Field(
        description="Last line number in the returned content (1-indexed, inclusive).",
    )
    is_partial: bool = Field(
        description="True if only a subset of lines was requested, "
        "False if returning full content.",
    )
