"""Service layer for prompt CRUD operations."""
import logging
from typing import Any
from uuid import UUID

from jinja2 import Environment, TemplateSyntaxError, meta
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, selectinload

from models.prompt import Prompt
from models.tag import prompt_tags
from schemas.prompt import PromptCreate, PromptUpdate
from services.base_entity_service import BaseEntityService
from services.tag_service import get_or_create_tags, update_prompt_tags

logger = logging.getLogger(__name__)

# Jinja2 environment for template validation
_jinja_env = Environment()


class NameConflictError(Exception):
    """Raised when a prompt name conflicts with an existing active prompt."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"A prompt with name '{name}' already exists")


def validate_template(content: str | None, arguments: list[dict[str, Any]]) -> None:
    """
    Validate Jinja2 template syntax and variables.

    Args:
        content: The Jinja2 template content (required, cannot be empty).
        arguments: List of argument definitions with 'name' keys.

    Raises:
        ValueError: If content is empty, template has invalid syntax,
                    uses undefined variables, or has unused arguments.

    Note:
        This validation uses meta.find_undeclared_variables() which also flags Jinja2
        built-in globals (e.g., range, loop, cycler, namespace) as "undefined" if used.
        Currently, templates should use simple {{ variable }} substitution. If control
        structures with builtins are needed, add a JINJA_BUILTINS allowlist to exclude
        from the undefined check.
    """
    # Content is required - a prompt without content is useless
    if not content or not content.strip():
        raise ValueError("Template content is required.")

    defined_args = {arg["name"] for arg in arguments} if arguments else set()

    # Validate syntax first
    try:
        ast = _jinja_env.parse(content)
    except TemplateSyntaxError as e:
        raise ValueError(f"Invalid Jinja2 syntax: {e.message}") from e

    # Check for undefined variables
    # Note: This will flag Jinja2 builtins (range, loop, etc.) as undefined.
    # For simple variable substitution templates, this is fine. If builtins are
    # needed in the future, add an allowlist here.
    template_vars = meta.find_undeclared_variables(ast)

    # Check for undefined variables (used in template but not in arguments)
    undefined = template_vars - defined_args
    if undefined:
        raise ValueError(
            f"Template uses undefined variable(s): {', '.join(sorted(undefined))}. "
            "Add them to arguments or remove from template.",
        )

    # Check for unused arguments (defined but not used in template)
    unused = defined_args - template_vars
    if unused:
        raise ValueError(
            f"Unused argument(s): {', '.join(sorted(unused))}. "
            "Remove them or use in template.",
        )


class PromptService(BaseEntityService[Prompt]):
    """
    Prompt service with full CRUD operations.

    Extends BaseEntityService with prompt-specific:
    - Text search fields (name, title, description, content)
    - Sort columns (title uses COALESCE with name for null handling)
    - Template validation on create/update
    - Name uniqueness enforcement
    """

    model = Prompt
    junction_table = prompt_tags
    entity_name = "Prompt"

    def _build_text_search_filter(self, pattern: str) -> list:
        """Build text search filter for prompt fields."""
        return [
            or_(
                Prompt.name.ilike(pattern),
                Prompt.title.ilike(pattern),
                Prompt.description.ilike(pattern),
                Prompt.content.ilike(pattern),
            ),
        ]

    def _get_sort_columns(self) -> dict[str, InstrumentedAttribute]:
        """Get sort columns for prompts."""
        return {
            "created_at": Prompt.created_at,
            "updated_at": Prompt.updated_at,
            "last_used_at": Prompt.last_used_at,
            "title": func.coalesce(Prompt.title, Prompt.name),
            "archived_at": Prompt.archived_at,
            "deleted_at": Prompt.deleted_at,
        }

    async def create(
        self,
        db: AsyncSession,
        user_id: UUID,
        data: PromptCreate,
    ) -> Prompt:
        """
        Create a new prompt for a user.

        Args:
            db: Database session.
            user_id: User ID to create the prompt for.
            data: Prompt creation data.

        Returns:
            The created prompt.

        Raises:
            NameConflictError: If a prompt with the same name already exists for this user.
            ValueError: If template validation fails.
        """
        # Convert arguments to list of dicts for validation and storage
        arguments_list = [arg.model_dump() for arg in data.arguments]

        # Validate template
        validate_template(data.content, arguments_list)

        # Get or create tags
        tag_objects = await get_or_create_tags(db, user_id, data.tags)

        prompt = Prompt(
            user_id=user_id,
            name=data.name,
            title=data.title,
            description=data.description,
            content=data.content,
            arguments=arguments_list,
            archived_at=data.archived_at,
        )
        prompt.tag_objects = tag_objects
        db.add(prompt)

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            # Check if it's a name uniqueness violation
            if "uq_prompt_user_name_active" in str(e):
                raise NameConflictError(data.name) from e
            raise

        await db.refresh(prompt)
        await db.refresh(prompt, attribute_names=["tag_objects"])

        # Set last_used_at to match created_at for "never viewed" detection
        prompt.last_used_at = prompt.created_at
        await db.flush()

        return prompt

    async def update(
        self,
        db: AsyncSession,
        user_id: UUID,
        prompt_id: UUID,
        data: PromptUpdate,
    ) -> Prompt | None:
        """
        Update a prompt.

        Args:
            db: Database session.
            user_id: User ID to scope the prompt.
            prompt_id: ID of the prompt to update.
            data: Update data.

        Returns:
            The updated prompt, or None if not found.

        Raises:
            NameConflictError: If name change conflicts with existing prompt.
            ValueError: If template validation fails.
        """
        prompt = await self.get(db, user_id, prompt_id, include_archived=True)
        if prompt is None:
            return None

        update_data = data.model_dump(exclude_unset=True)
        new_tags = update_data.pop("tags", None)

        # Handle arguments - convert Pydantic models to dicts if present
        # Note: arguments=None means "no change" since the model is nullable=False.
        # To clear arguments, send arguments=[] explicitly.
        if "arguments" in update_data:
            if update_data["arguments"] is None:
                # Treat None as "no change" - remove from update_data
                del update_data["arguments"]
            else:
                update_data["arguments"] = [
                    arg.model_dump() if hasattr(arg, "model_dump") else arg
                    for arg in update_data["arguments"]
                ]

        # Determine final content and arguments for validation
        # Use updated values if provided, otherwise use existing values
        final_content = update_data.get("content", prompt.content)
        final_arguments = update_data.get("arguments", prompt.arguments)

        # Validate template if content or arguments changed
        if "content" in update_data or "arguments" in update_data:
            validate_template(final_content, final_arguments)

        # Apply updates
        for field, value in update_data.items():
            setattr(prompt, field, value)

        # Update tags if provided
        if new_tags is not None:
            await update_prompt_tags(db, prompt, new_tags)

        prompt.updated_at = func.clock_timestamp()

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            # Check if it's a name uniqueness violation
            if "uq_prompt_user_name_active" in str(e):
                # Use data.name if provided, otherwise fall back to prompt.name
                conflict_name = data.name if data.name else prompt.name
                raise NameConflictError(conflict_name) from e
            raise

        await self._refresh_with_tags(db, prompt)
        return prompt

    async def get_by_name(
        self,
        db: AsyncSession,
        user_id: UUID,
        name: str,
    ) -> Prompt | None:
        """
        Get a prompt by name for a user.

        Returns only active prompts (excludes deleted AND archived).
        This is used by the MCP server for prompt lookups.

        Args:
            db: Database session.
            user_id: User ID to scope the prompt.
            name: Name of the prompt to find.

        Returns:
            The prompt if found and active, None otherwise.
        """
        result = await db.execute(
            select(Prompt)
            .options(selectinload(Prompt.tag_objects))
            .where(
                Prompt.user_id == user_id,
                Prompt.name == name,
                Prompt.deleted_at.is_(None),
                ~Prompt.is_archived,
            ),
        )
        return result.scalar_one_or_none()


# Module-level service instance
prompt_service = PromptService()
