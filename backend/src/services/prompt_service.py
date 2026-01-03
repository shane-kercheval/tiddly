"""Service for prompt CRUD operations."""
from typing import Any

from jinja2 import Environment, TemplateSyntaxError, meta
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt
from schemas.prompt import PromptCreate, PromptUpdate


_jinja_env = Environment()


def validate_template(content: str | None, arguments: list[dict[str, Any]]) -> None:
    """
    Validate Jinja2 template syntax and variables.

    Args:
        content: Jinja2 template string
        arguments: List of argument definitions [{name, description, required}]

    Raises:
        ValueError: If template has invalid syntax or uses undefined variables.
    """
    if not content:
        return

    # Validate syntax first - don't swallow syntax errors
    try:
        ast = _jinja_env.parse(content)
    except TemplateSyntaxError as e:
        raise ValueError(f"Invalid Jinja2 syntax: {e.message}")

    # Check for undefined variables
    template_vars = meta.find_undeclared_variables(ast)
    if not template_vars:
        return

    defined_args = {arg["name"] for arg in arguments} if arguments else set()
    undefined = template_vars - defined_args

    if undefined:
        raise ValueError(
            f"Template uses undefined variable(s): {', '.join(sorted(undefined))}. "
            "Add them to arguments or remove from template.",
        )


class PromptService:
    """Service for prompt CRUD operations."""

    async def create(
        self,
        db: AsyncSession,
        user_id: int,
        data: PromptCreate,
    ) -> Prompt:
        """
        Create a new prompt.

        Validates template variables match arguments.

        Args:
            db: Database session
            user_id: ID of the user creating the prompt
            data: Prompt creation data

        Returns:
            Created prompt

        Raises:
            ValueError: If template validation fails or name already exists.
        """
        # Validate template first (fast fail before DB operations)
        args_as_dicts = [arg.model_dump() for arg in data.arguments]
        validate_template(data.content, args_as_dicts)

        prompt = Prompt(
            user_id=user_id,
            name=data.name,
            title=data.title,
            description=data.description,
            content=data.content,
            arguments=args_as_dicts,
        )
        db.add(prompt)

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            # Check if it's a unique constraint violation
            if "uq_prompts_user_name" in str(e.orig):
                raise ValueError(f"Prompt with name '{data.name}' already exists")
            raise  # Re-raise unexpected integrity errors

        await db.refresh(prompt)
        return prompt

    async def get_by_name(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
    ) -> Prompt | None:
        """
        Get a prompt by name.

        Args:
            db: Database session
            user_id: ID of the user
            name: Prompt name

        Returns:
            Prompt if found, None otherwise
        """
        result = await db.execute(
            select(Prompt).where(
                Prompt.user_id == user_id,
                Prompt.name == name,
            ),
        )
        return result.scalar_one_or_none()

    async def get_by_id(
        self,
        db: AsyncSession,
        user_id: int,
        prompt_id: int,
    ) -> Prompt | None:
        """
        Get a prompt by ID.

        Args:
            db: Database session
            user_id: ID of the user
            prompt_id: Prompt ID

        Returns:
            Prompt if found, None otherwise
        """
        result = await db.execute(
            select(Prompt).where(
                Prompt.user_id == user_id,
                Prompt.id == prompt_id,
            ),
        )
        return result.scalar_one_or_none()

    async def list(
        self,
        db: AsyncSession,
        user_id: int,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[Prompt], int]:
        """
        List all prompts for a user.

        Args:
            db: Database session
            user_id: ID of the user
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            Tuple of (list of prompts, total count)
        """
        # Get total count
        count_result = await db.execute(
            select(func.count(Prompt.id)).where(Prompt.user_id == user_id),
        )
        total = count_result.scalar() or 0

        # Get prompts ordered by updated_at desc
        result = await db.execute(
            select(Prompt)
            .where(Prompt.user_id == user_id)
            .order_by(Prompt.updated_at.desc())
            .offset(offset)
            .limit(limit),
        )
        prompts = list(result.scalars().all())

        return prompts, total

    async def update(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
        data: PromptUpdate,
    ) -> Prompt | None:
        """
        Update a prompt.

        Args:
            db: Database session
            user_id: ID of the user
            name: Current prompt name
            data: Update data

        Returns:
            Updated prompt if found, None otherwise

        Raises:
            ValueError: If template validation fails or new name already exists.
        """
        prompt = await self.get_by_name(db, user_id, name)
        if not prompt:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # Determine effective content and arguments for validation
        effective_content = update_data.get("content", prompt.content)

        if "arguments" in update_data:
            # Convert PromptArgument models to dicts if needed
            args_list = update_data["arguments"]
            args_as_dicts = [
                arg.model_dump() if hasattr(arg, "model_dump") else arg
                for arg in args_list
            ]
        else:
            args_as_dicts = prompt.arguments

        # Validate template with effective values
        validate_template(effective_content, args_as_dicts)

        # Track new name for error message
        new_name = update_data.get("name")

        # Apply updates
        for field, value in update_data.items():
            if field == "arguments":
                setattr(prompt, field, args_as_dicts)
            else:
                setattr(prompt, field, value)

        # Always update the timestamp
        prompt.updated_at = func.clock_timestamp()

        try:
            await db.flush()
        except IntegrityError as e:
            await db.rollback()
            if "uq_prompts_user_name" in str(e.orig) and new_name:
                raise ValueError(f"Prompt with name '{new_name}' already exists")
            raise

        await db.refresh(prompt)
        return prompt

    async def delete(
        self,
        db: AsyncSession,
        user_id: int,
        name: str,
    ) -> bool:
        """
        Delete a prompt.

        Args:
            db: Database session
            user_id: ID of the user
            name: Prompt name

        Returns:
            True if deleted, False if not found
        """
        prompt = await self.get_by_name(db, user_id, name)
        if not prompt:
            return False

        await db.delete(prompt)
        await db.flush()
        return True


# Module-level instance
prompt_service = PromptService()
