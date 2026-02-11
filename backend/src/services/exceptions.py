"""Shared exceptions for service layer operations."""
from uuid import UUID


class InvalidStateError(Exception):
    """
    Raised when an operation is invalid for a resource's current state.

    Used by both bookmark and note services when operations cannot be performed
    due to the resource's state (e.g., restoring a non-deleted item, unarchiving
    a non-archived item).
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)


class QuotaExceededError(Exception):
    """
    Raised when user has reached their item limit for a content type.

    All rows count toward limits (including archived and soft-deleted).
    Users can permanently delete items to free quota.
    """

    def __init__(self, resource: str, current: int, limit: int) -> None:
        self.resource = resource
        self.current = current
        self.limit = limit
        super().__init__(
            f"{resource.capitalize()} limit reached ({limit}). "
            "Permanently delete items from trash to free space, or upgrade.",
        )


class FieldLimitExceededError(Exception):
    """
    Raised when a field exceeds tier-specific length limit.

    Used for title, description, content, URL, tag name, and argument fields.
    """

    def __init__(self, field: str, current: int, limit: int) -> None:
        self.field = field
        self.current = current
        self.limit = limit
        super().__init__(f"{field.capitalize()} exceeds limit of {limit} characters")


class RelationshipError(Exception):
    """Base class for relationship errors."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ContentNotFoundError(RelationshipError):
    """Referenced content does not exist or does not belong to the user."""

    def __init__(self, content_type: str, content_id: UUID) -> None:
        self.content_type = content_type
        self.content_id = content_id
        super().__init__(f"{content_type.capitalize()} {content_id} not found")


class DuplicateRelationshipError(RelationshipError):
    """Relationship already exists between the given content items."""

    def __init__(self) -> None:
        super().__init__("Relationship already exists")


class InvalidRelationshipError(RelationshipError):
    """Invalid relationship (e.g., self-reference, invalid type combination)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class SidebarValidationError(Exception):
    """
    Base exception for sidebar validation errors.

    Raised when sidebar structure validation fails (duplicates, invalid items, etc).
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)


class SidebarDuplicateItemError(SidebarValidationError):
    """Raised when a duplicate item is found in the sidebar structure."""

    def __init__(self, item_type: str, item_id: str | UUID) -> None:
        self.item_type = item_type
        self.item_id = item_id
        super().__init__(f"Duplicate {item_type} item: {item_id}")


class SidebarFilterNotFoundError(SidebarValidationError):
    """Raised when a filter ID in the sidebar doesn't exist or doesn't belong to the user."""

    def __init__(self, filter_id: UUID) -> None:
        self.filter_id = filter_id
        super().__init__(f"Filter not found or not owned by user: {filter_id}")


class SidebarNestedCollectionError(SidebarValidationError):
    """Raised when collections are nested (not allowed)."""

    def __init__(self) -> None:
        super().__init__("Nested collections are not allowed")
