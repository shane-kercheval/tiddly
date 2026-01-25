# MCP Server Evaluations

This directory contains evaluation tests for the MCP servers using the [flex-evals](https://github.com/shane-kercheval/flex-evals) framework.

These evals verify that LLMs can correctly use the MCP tools by:
1. Creating realistic test scenarios
2. Getting LLM tool predictions
3. Executing the predicted tools
4. Verifying the results match expectations

## Prerequisites

Before running evaluations, ensure:

1. Your `.env` file has:
   ```bash
   VITE_DEV_MODE=true  # Bypasses authentication
   OPENAI_API_KEY=sk-...
   ```

2. **Start Docker containers** (PostgreSQL + Redis):
   ```bash
   make docker-up
   ```

3. **Run database migrations** (if needed):
   ```bash
   make migrate
   ```

4. **Start the API server** (port 8000):
   ```bash
   make api-run
   ```

5. **Start the MCP server(s)** - in separate terminals:
   ```bash
   # For Content MCP evals
   make content-mcp-server

   # For Prompt MCP evals (when available)
   make prompt-mcp-server
   ```

6. **Node.js** (for `npx` to run `mcp-remote`):
   - Ensure Node.js is installed
   - `npx` will automatically download `mcp-remote` on first use

## Running Evaluations

From the project root:

```bash
# Run all evals
make evals

# Run specific eval suite
make evals-content-mcp
make evals-prompt-mcp

# Run with verbose output
uv run pytest evals/ -v

# Run specific eval tests
uv run pytest evals/content_mcp/test_edit_content.py -v
uv run pytest evals/content_mcp/test_update_item.py -v
uv run pytest evals/prompt_mcp/test_edit_prompt_content.py -v
uv run pytest evals/prompt_mcp/test_update_prompt.py -v
```

## Directory Structure

```
evals/
├── README.md                           # This file
├── conftest.py                         # Shared pytest fixtures
├── utils.py                            # Shared helper functions
├── content_mcp/                        # Content MCP server evals
│   ├── config_edit_content.yaml        # edit_content test cases
│   ├── test_edit_content.py            # edit_content eval tests
│   ├── config_update_item.yaml         # update_item test cases
│   └── test_update_item.py             # update_item eval tests
└── prompt_mcp/                          # Prompt MCP server evals
    ├── config_edit_prompt_content.yaml  # edit_prompt_content test cases
    ├── test_edit_prompt_content.py      # edit_prompt_content eval tests
    ├── config_update_prompt.yaml        # update_prompt test cases
    └── test_update_prompt.py            # update_prompt eval tests
```

## Configuration

Each eval suite has a `config.yaml` that defines:

### Model Configuration
```yaml
model:
  name: "gpt-4.1-mini"
  temperature: 0  # Use 0 for reproducibility
```

### Evaluation Parameters
```yaml
eval:
  samples: 5              # Number of times to run each test case
  success_threshold: 0.8  # Minimum pass rate (80%)
```

### Test Cases
```yaml
test_cases:
  - id: "fix-typo-prefix-word"
    input:
      content: |
        This docu needs to be updated.
        See the documentation for more details.
      search_query: "docu"
    expected:
      tool_name: "edit_content"
      old_str_contains: "docu"
      new_str_contains: "document"
      final_must_contain: "document"
    metadata:
      description: "Fix 'docu' -> 'document' without corrupting 'documentation'"
```

### Checks
```yaml
checks:
  - type: "exact_match"
    arguments:
      actual: "$.output.value.tool_prediction.tool_name"
      expected: "$.test_case.expected.tool_name"

  - type: "contains"
    arguments:
      text: "$.output.value.final_content"
      phrases: "$.test_case.expected.final_must_contain"
```

## Adding New Evaluations

1. Create a new directory under `evals/` (e.g., `evals/prompt_mcp/`)
2. Add a `config.yaml` with test cases and checks
3. Create test file(s) using the `@evaluate` decorator
4. Use shared utilities from `evals/utils.py`

## How It Works

The eval framework uses `flex-evals` with pytest:

1. **Test cases** are loaded from YAML and converted to `TestCase` objects
2. **Checks** are loaded from YAML and converted to `Check` objects using `get_check_class()`
3. The `@evaluate` decorator runs each test case `samples` times
4. Each run creates content, gets an LLM prediction, executes the tool, and cleans up
5. Checks validate the results using JSONPath expressions
6. The test passes if `success_threshold` of samples pass all checks

## Debugging

If evaluations fail, check:

1. **MCP servers running**: Ensure both API and MCP servers are up
2. **API key valid**: Check `OPENAI_API_KEY` in `.env`
3. **Database accessible**: Run `make docker-up` if containers are down
4. **Verbose output**: Run with `-v` flag for detailed failure info

## Findings

### evals/prompt_mcp/test_update_prompt.py

**Tests whether LLMs can:**
- Choose `update_prompt` over `edit_prompt_content` when appropriate
- Omit `arguments` parameter when template variables aren't changing
- Omit `tags` parameter when not updating tags
- Include ALL existing tags when adding a new tag (full replacement)

**Findings** (models tested: gpt-4.1-mini, gpt-4.1, gpt-5.1, gpt-5.2):

#### Key Takeaways

1. **LLMs prefer surgical edits over full replacement** - Models choose `edit_prompt_content` over `update_prompt` even when full replacement is more appropriate.

2. **"Full replacement" semantics are hard for LLMs** - Parameters like `arguments` and `tags` replace the entire list (not merge). Models often:
   - Provide `arguments` when they should omit it (risking data loss)
   - Provide `tags` when they should omit it (risking data loss)
   - Only provide new tags instead of all tags (removing existing ones)

3. **Model reliability varies**
    - gpt-4.1-mini & gpt-4.1: had 0% success rate across all test cases
    - gpt-5.2 is the only one that passes at 0.6 threshold but still has sporadic failures.

4. **Tool descriptions help but don't guarantee correct behavior** - We did see significant improvement when adding detailed tool descriptions in the prompt, but models still made mistakes.

### evals/content_mcp/test_update_item.py

**Tests whether LLMs can:**
- Choose `update_item` over `edit_content` when appropriate
- Omit `tags` parameter when not updating tags
- Include ALL existing tags when adding a new tag (full replacement)

**Findings** (models tested: gpt-4.1-mini, gpt-4.1):

#### Key Takeaways

1. **Showing full tool results is critical** - Initial eval only showed content, not tags. LLM would call `get_item` again to see tags before updating. After showing full `get_item` result (including tags), gpt-4.1 passes.

2. **gpt-4.1-mini still fails** - Even with full tool results, gpt-4.1-mini has 0% success rate. Use gpt-4.1 or higher.

3. **Same "full replacement" challenges as prompts** - Tags require providing ALL values when updating.
