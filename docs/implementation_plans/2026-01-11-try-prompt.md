# Try Prompt: Preview Rendered Templates

## Overview

Add the ability for users to preview how their prompt templates will render with specific arguments. This lets users test Jinja2 conditionals, verify whitespace handling, and validate template behavior before using prompts with AI agents.

### Goals

1. Share template rendering logic between REST API and MCP server (single source of truth)
2. Add a REST API endpoint to render prompts with user-provided arguments
3. Add frontend modal to input arguments and display rendered output

### Constraints

- Users cannot try prompts with unsaved changes (only saved prompts can be rendered)
- Rendered output uses identical Jinja2 logic as MCP server (same Python engine)
- Frontend displays plain text output (no markdown rendering)

### Why Not Call MCP Server from Frontend?

The MCP server uses a specialized protocol designed for AI assistants, not browser clients. It uses SSE transport and context-scoped authentication via `contextvars`. Adding a REST API endpoint:
- Follows existing frontend ↔ API patterns
- Uses established Auth0/PAT authentication
- Keeps MCP server focused on its purpose (serving AI agents)
- Ensures identical rendering via shared module

---

## Pre-Implementation: Verify Template Renderer Dependencies

Before moving the template renderer, check what imports from it.

### Search Commands

```bash
# Find all imports of template_renderer
grep -r "template_renderer" backend/src/
grep -r "render_template" backend/src/
grep -r "TemplateError" backend/src/
```

### Expected Results

- `prompt_mcp_server/server.py` - imports `render_template` and `TemplateError`
- `prompt_mcp_server/__init__.py` - may re-export

If other files import, assess their update needs.

---

## Milestone 1: Move Template Renderer to Shared Location

### Goal

Extract the template rendering module from `prompt_mcp_server/` to `services/` so both the MCP server and REST API can use identical rendering logic.

### Current Location

```
backend/src/prompt_mcp_server/template_renderer.py
```

### New Location

```
backend/src/services/template_renderer.py
```

### Changes Required

1. **Move the file:**
   ```bash
   mv backend/src/prompt_mcp_server/template_renderer.py backend/src/services/template_renderer.py
   ```

2. **Update MCP server import** (`prompt_mcp_server/server.py`):
   ```python
   # Before
   from .template_renderer import TemplateError, render_template

   # After
   from services.template_renderer import TemplateError, render_template
   ```

3. **Verify tests still pass:**
   - Run `make unit_tests` to ensure nothing breaks

### Success Criteria

- [ ] `template_renderer.py` moved to `services/`
- [ ] MCP server imports from new location
- [ ] All existing tests pass
- [ ] MCP server still renders prompts correctly (manual test)

### Testing Strategy

1. Run `make unit_tests` - all backend tests should pass
2. Start the prompt MCP server and verify prompts render correctly

---

## Milestone 2: Add REST API Render Endpoint

### Goal

Add a `POST /prompts/{id}/render` endpoint that renders a saved prompt with user-provided arguments.

### New Schemas

Add to `backend/src/schemas/prompt.py`:

```python
class PromptRenderRequest(BaseModel):
    """Request schema for rendering a prompt with arguments."""

    arguments: dict[str, str] = Field(
        default_factory=dict,
        description="Argument values keyed by argument name",
    )


class PromptRenderResponse(BaseModel):
    """Response schema for rendered prompt content."""

    rendered_content: str = Field(
        description="The rendered template with arguments applied",
    )
```

### New Endpoint

Add to `backend/src/api/routers/prompts.py`:

```python
from services.template_renderer import TemplateError, render_template
from schemas.prompt import PromptRenderRequest, PromptRenderResponse


@router.post("/{prompt_id}/render", response_model=PromptRenderResponse)
async def render_prompt(
    prompt_id: UUID,
    request: PromptRenderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptRenderResponse:
    """
    Render a prompt template with provided arguments.

    Returns the template with Jinja2 variables replaced by argument values.
    Uses identical rendering logic as the MCP server.

    - Required arguments must be provided
    - Unknown arguments are rejected
    - Optional arguments default to empty string (enables {% if var %} conditionals)
    """
    # Fetch prompt (include archived/deleted so users can test any saved prompt)
    prompt = await prompt_service.get(
        db, current_user.id, prompt_id, include_archived=True, include_deleted=True,
    )
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")

    if not prompt.content:
        return PromptRenderResponse(rendered_content="")

    try:
        rendered = render_template(
            content=prompt.content,
            arguments=request.arguments,
            defined_args=prompt.arguments or [],
        )
    except TemplateError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return PromptRenderResponse(rendered_content=rendered)
```

### Error Cases

| Scenario | Status | Response |
|----------|--------|----------|
| Prompt not found | 404 | `{"detail": "Prompt not found"}` |
| Missing required argument | 400 | `{"detail": "Missing required argument(s): arg_name"}` |
| Unknown argument provided | 400 | `{"detail": "Unknown argument(s): bad_arg"}` |
| Template syntax error | 400 | `{"detail": "Template syntax error: ..."}` |
| No content | 200 | `{"rendered_content": ""}` |

### Success Criteria

- [ ] `PromptRenderRequest` and `PromptRenderResponse` schemas added
- [ ] `POST /prompts/{id}/render` endpoint implemented
- [ ] Endpoint uses shared `render_template` function
- [ ] Returns 404 for non-existent prompts
- [ ] Returns 400 for template errors (missing args, unknown args, syntax errors)
- [ ] Returns 200 with empty string for prompts without content
- [ ] Unit tests cover all error cases

### Testing Strategy

Create `backend/tests/api/routers/test_prompts_render.py`:

```python
"""Tests for POST /prompts/{id}/render endpoint."""

import pytest
from httpx import AsyncClient

# Test fixtures: create prompts with various argument configurations


class TestRenderPrompt:
    """Tests for the render prompt endpoint."""

    async def test__render_prompt__simple_template(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Renders a simple template with one argument."""
        # Create prompt with content "Hello, {{ name }}!"
        # POST /prompts/{id}/render with {"arguments": {"name": "World"}}
        # Assert response is "Hello, World!"

    async def test__render_prompt__missing_required_argument(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Returns 400 when required argument is missing."""
        # Create prompt with required argument
        # POST /prompts/{id}/render with empty arguments
        # Assert 400 with "Missing required argument(s)" message

    async def test__render_prompt__unknown_argument(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Returns 400 when unknown argument is provided."""
        # Create prompt with one defined argument
        # POST /prompts/{id}/render with extra argument
        # Assert 400 with "Unknown argument(s)" message

    async def test__render_prompt__optional_argument_defaults_to_empty(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Optional arguments default to empty string for conditionals."""
        # Create prompt: "{% if suffix %}{{ suffix }}{% endif %}end"
        # POST without suffix argument
        # Assert response is "end"

    async def test__render_prompt__conditional_with_optional_argument(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Optional argument provided enables conditional block."""
        # Create prompt: "Hello{% if suffix %}, {{ suffix }}{% endif %}!"
        # POST with suffix="friend"
        # Assert response is "Hello, friend!"

    async def test__render_prompt__not_found(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Returns 404 for non-existent prompt."""
        # POST to non-existent UUID
        # Assert 404

    async def test__render_prompt__empty_content(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Returns empty string when prompt has no content."""
        # Create prompt with empty/null content
        # POST render request
        # Assert response is ""

    async def test__render_prompt__archived_prompt(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Can render archived prompts."""
        # Create and archive prompt
        # POST render request
        # Assert successful render

    async def test__render_prompt__other_user_prompt_not_found(
        self, async_client: AsyncClient,
        test_user_token: str,
        other_user_token: str,
    ) -> None:
        """Returns 404 when trying to render another user's prompt."""
        # Create prompt as other user
        # POST render as test user
        # Assert 404 (not 403 - don't reveal existence)

    async def test__render_prompt__complex_jinja_template(
        self, async_client: AsyncClient, test_user_token: str,
    ) -> None:
        """Renders complex Jinja2 templates correctly."""
        # Create prompt with:
        # - Multiple variables
        # - Conditionals
        # - Whitespace control
        # Assert correct rendering
```

---

## Milestone 3: Add Frontend API Integration

### Goal

Add frontend types and API function to call the render endpoint.

### New Types

Add to `frontend/src/types.ts`:

```typescript
/** Request for rendering a prompt with arguments */
export interface PromptRenderRequest {
  arguments: Record<string, string>
}

/** Response from prompt render endpoint */
export interface PromptRenderResponse {
  rendered_content: string
}
```

### New API Function

Add to `frontend/src/hooks/usePrompts.ts`:

```typescript
/**
 * Render a prompt with the given arguments.
 * Returns the rendered template content.
 */
const renderPrompt = async (
  promptId: string,
  args: Record<string, string>,
): Promise<string> => {
  const response = await api.post<PromptRenderResponse>(
    `/prompts/${promptId}/render`,
    { arguments: args },
  )
  return response.data.rendered_content
}

// Add to return object
return {
  fetchPrompt,
  trackPromptUsage,
  renderPrompt,  // New
}
```

### Success Criteria

- [ ] `PromptRenderRequest` and `PromptRenderResponse` types added
- [ ] `renderPrompt` function added to `usePrompts` hook
- [ ] Function returns rendered content string

### Testing Strategy

Manual testing via browser console:
```javascript
// After logging in, from React DevTools or console
const { renderPrompt } = usePrompts()
await renderPrompt('prompt-id', { name: 'Test' })
```

---

## Milestone 4: Add TryPromptModal Component

### Goal

Create a modal that lets users input argument values and see the rendered output.

### Component File

Create `frontend/src/components/TryPromptModal.tsx`:

```typescript
interface TryPromptModalProps {
  isOpen: boolean
  onClose: () => void
  prompt: Prompt  // Must have id, name, arguments, content
}
```

### UI Layout

```
+-------------------------------------------------------------+
| Try Prompt: {prompt.name}                              [X]  |
+-------------------------------------------------------------+
|                                                             |
| Arguments                                                   |
| +----------------------------------------------------------+|
| | code_snippet (required)                                  ||
| | +------------------------------------------------------+ ||
| | |                                                      | ||
| | | (textarea for argument value)                        | ||
| | |                                                      | ||
| | +------------------------------------------------------+ ||
| |                                                          ||
| | language (optional)                                      ||
| | +------------------------------------------------------+ ||
| | | (input for argument value)                           | ||
| | +------------------------------------------------------+ ||
| +----------------------------------------------------------+|
|                                                             |
| [Render]                                                    |
|                                                             |
| Output                                                      |
| +----------------------------------------------------------+|
| |                                                          ||
| | (rendered output, monospace, scrollable)                 ||
| |                                                          ||
| +----------------------------------------------------------+|
|                                                             |
+-------------------------------------------------------------+
```

### State Management

```typescript
// Track argument values
const [argValues, setArgValues] = useState<Record<string, string>>({})

// Track render state
const [renderedOutput, setRenderedOutput] = useState<string | null>(null)
const [isRendering, setIsRendering] = useState(false)
const [error, setError] = useState<string | null>(null)

// Reset state when modal opens
useEffect(() => {
  if (isOpen) {
    setArgValues({})
    setRenderedOutput(null)
    setError(null)
  }
}, [isOpen])
```

### Key Behaviors

1. **Argument inputs:**
   - Show each defined argument with its name and description
   - Mark required arguments with asterisk or "(required)" label
   - Use textarea for multi-line values, input for single-line
   - Clear placeholder: "Enter value for {arg_name}"

2. **Render button:**
   - Disabled while rendering
   - Shows loading state during API call
   - Calls `renderPrompt(prompt.id, argValues)`

3. **Output display:**
   - Monospace font (`font-mono`)
   - Preserve whitespace (`whitespace-pre-wrap`)
   - Scrollable container with max height
   - Show placeholder text before first render: "Click Render to see output"

4. **Error handling:**
   - Display API errors (missing args, unknown args) in red
   - Clear error when user modifies arguments

5. **No arguments case:**
   - If prompt has no arguments, show message: "This prompt has no arguments"
   - Still allow rendering to see the static content

### Implementation Notes

- Use the existing `Modal` component wrapper
- Set `maxWidth="max-w-2xl"` for wider modal (more space for output)
- Arguments section: iterate over `prompt.arguments`
- Use controlled inputs that update `argValues` state

### Success Criteria

- [ ] `TryPromptModal` component created
- [ ] Shows argument inputs with names and required indicators
- [ ] Render button calls API and displays output
- [ ] Output displayed in monospace, whitespace-preserved
- [ ] Error messages shown for validation failures
- [ ] State resets when modal opens
- [ ] Handles prompts with no arguments

### Testing Strategy

Manual testing:
1. Open modal for prompt with required + optional arguments
2. Submit without required args - should show error
3. Fill required args and render - should show output
4. Change arguments and re-render - should update output
5. Close and reopen modal - state should reset
6. Test with prompt that has no arguments

Consider adding component tests if time permits:
- Test argument input rendering
- Test render button disabled state
- Test error display

---

## Milestone 5: Integrate Try Prompt Button in Prompt Editor

### Goal

Add a "Try Prompt" button to the prompt editor that opens the modal.

### Location

In `frontend/src/components/Prompt.tsx`, add the button to the action bar (near Save/Delete buttons).

### Button Placement

The button should be:
- Visible only for saved prompts (not during create)
- Disabled when the prompt has unsaved changes (`isDirty`)
- Positioned logically with other actions

### Changes to Prompt.tsx

```typescript
// Import modal
import { TryPromptModal } from './TryPromptModal'

// Add state for modal
const [isTryModalOpen, setIsTryModalOpen] = useState(false)

// In the action bar (adjust based on existing layout)
{!isCreateMode && (
  <button
    type="button"
    onClick={() => setIsTryModalOpen(true)}
    disabled={isDirty}
    title={isDirty ? "Save changes before trying prompt" : "Try this prompt with arguments"}
    className="..."
  >
    Try
  </button>
)}

// Add modal at end of component
<TryPromptModal
  isOpen={isTryModalOpen}
  onClose={() => setIsTryModalOpen(false)}
  prompt={prompt}  // The saved prompt object
/>
```

### Button States

| State | Behavior |
|-------|----------|
| Create mode | Button hidden (no prompt to try) |
| Edit mode, clean | Button enabled, opens modal |
| Edit mode, dirty | Button disabled with tooltip |

### Tooltip/Title

- Enabled: "Try this prompt with arguments"
- Disabled: "Save changes before trying prompt"

### Success Criteria

- [ ] "Try" button added to prompt editor
- [ ] Button hidden during prompt creation
- [ ] Button disabled when prompt has unsaved changes
- [ ] Button opens `TryPromptModal` with current prompt
- [ ] Modal displays and functions correctly
- [ ] Clear visual distinction for disabled state

### Testing Strategy

Manual testing:
1. Create new prompt - Try button should not appear
2. View existing prompt - Try button should be enabled
3. Make changes without saving - Try button should be disabled
4. Save changes - Try button should be enabled again
5. Click Try - modal should open with prompt data

---

## Summary

| Milestone | Changes | Key Files |
|-----------|---------|-----------|
| 1. Move template renderer | Relocate to shared location | `services/template_renderer.py` |
| 2. Add render endpoint | REST API endpoint | `api/routers/prompts.py`, `schemas/prompt.py` |
| 3. Frontend API | Types and API function | `types.ts`, `hooks/usePrompts.ts` |
| 4. Try modal | New component | `components/TryPromptModal.tsx` |
| 5. Integration | Connect button to modal | `components/Prompt.tsx` |

**Estimated scope:** ~200-300 lines of new code (backend + frontend)

---

## Appendix: Design Decisions

### Why require saved prompts?

Rendering unsaved content would require:
1. A separate endpoint that accepts arbitrary content (not just prompt ID)
2. Potential security considerations for arbitrary Jinja2 rendering
3. Confusion about which version was tested

By requiring saved prompts, we ensure:
- Users test exactly what's stored
- Clear workflow: edit -> save -> test
- API only renders content it owns

### Why not render in frontend with JavaScript?

JavaScript Jinja2 libraries (nunjucks, jinja-js) have subtle differences from Python's Jinja2. Users need to see exactly what AI agents will see, which requires using the same Python rendering engine.

### Why include archived/deleted prompts?

Users might want to test prompts before unarchiving/restoring them. Since rendering is read-only and doesn't affect the prompt, there's no risk in allowing it for any saved prompt the user owns.
