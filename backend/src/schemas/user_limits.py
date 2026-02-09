"""Schema for user limits response."""
from pydantic import BaseModel


class UserLimitsResponse(BaseModel):
    """Response model for user tier limits."""

    tier: str

    # Item counts
    max_bookmarks: int
    max_notes: int
    max_prompts: int

    # Field lengths (common)
    max_title_length: int
    max_description_length: int
    max_tag_name_length: int

    # Field lengths (content - per entity type)
    max_bookmark_content_length: int
    max_note_content_length: int
    max_prompt_content_length: int

    # Field lengths (entity-specific)
    max_url_length: int
    max_prompt_name_length: int
    max_argument_name_length: int
    max_argument_description_length: int

    # Rate limits
    rate_read_per_minute: int
    rate_read_per_day: int
    rate_write_per_minute: int
    rate_write_per_day: int
    rate_sensitive_per_minute: int
    rate_sensitive_per_day: int
