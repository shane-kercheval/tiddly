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

# Run with verbose output
uv run pytest evals/ -v

# Run a specific test
uv run pytest evals/content_mcp/test_edit_content.py -v
```

## Directory Structure

```
evals/
├── README.md           # This file
├── conftest.py         # Shared pytest fixtures (MCP connections)
├── utils.py            # Shared helper functions
└── content_mcp/        # Content MCP server evals
    ├── config.yaml     # Test cases, checks, and model config
    └── test_edit_content.py
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
