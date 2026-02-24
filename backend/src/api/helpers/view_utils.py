"""View parameter validation helpers."""
from fastapi import HTTPException

from schemas.content import ViewOption


def validate_view(view: list[ViewOption]) -> set[ViewOption]:
    """Validate view list is non-empty and convert to set."""
    if not view:
        raise HTTPException(status_code=422, detail="At least one view option is required")
    return set(view)
