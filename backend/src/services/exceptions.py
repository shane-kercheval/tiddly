"""Shared exceptions for service layer operations."""


class InvalidStateError(Exception):
    """
    Raised when an operation is invalid for a resource's current state.

    Used by both bookmark and note services when operations cannot be performed
    due to the resource's state (e.g., restoring a non-deleted item, unarchiving
    a non-archived item).
    """

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

    def __init__(self, item_type: str, item_id: str | int) -> None:
        self.item_type = item_type
        self.item_id = item_id
        super().__init__(f"Duplicate {item_type} item: {item_id}")


class SidebarListNotFoundError(SidebarValidationError):
    """Raised when a list ID in the sidebar doesn't exist or doesn't belong to the user."""

    def __init__(self, list_id: int) -> None:
        self.list_id = list_id
        super().__init__(f"List not found or not owned by user: {list_id}")


class SidebarNestedGroupError(SidebarValidationError):
    """Raised when groups are nested (not allowed)."""

    def __init__(self) -> None:
        super().__init__("Nested groups are not allowed")
