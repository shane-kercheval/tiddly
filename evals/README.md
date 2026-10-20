# Evaluations

This directory contains two kinds of LLM evaluations, both using the [flex-evals](https://github.com/shane-kercheval/flex-evals) framework:

- **MCP server evals** (`content_mcp/`, `prompt_mcp/`) verify that LLMs can correctly use the MCP tools by:
  1. Creating realistic test scenarios
  2. Getting LLM tool predictions
  3. Executing the predicted tools
  4. Verifying the results match expectations

  They run on `gpt-4o-mini` and `claude-haiku-4-5`. OpenAI shuts down `gpt-4o-mini` on 2027-01-14, so these evals need moving to current models before then; the agreed approach is in the [LLM model refresh plan's known limitations](../docs/implementation_plans/2026-10-19-llm-model-refresh.md#known-limitations) (the MCP tool evals entry).
- **AI suggestion evals** (`ai_suggestions/`) measure the quality of the AI suggestion endpoints across models. They need only provider keys, not the servers below; see [AI Suggestion Evaluations](#ai-suggestion-evaluations).

## Prerequisites (MCP server evals)

Before running the MCP server evaluations, ensure:

1. Your `.env` file has:
   ```bash
   VITE_DEV_MODE=true  # Bypasses authentication
   ANTHROPIC_API_KEY=sk-ant-...
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

uv run pytest 'evals/prompt_mcp/test_update_prompt.py::test_update_prompt[gpt-4o-mini]'
```

**NOTE**: Changes to MCP Servers (e.g. instructions/tool-descriptions, code changes to servers) are not hot reloaded; the MCP Servers need to be restarted.

## AI Suggestion Evaluations

`evals/ai_suggestions/` measures the quality of the five AI suggestion endpoints: tags, metadata, relationships, prompt arguments (generate all), and prompt argument fields (refine one). Each suite calls the backend's suggestion function for its endpoint (e.g. `suggest_tags`) directly, so it needs only the provider keys in the repo-root `.env` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`), not the API, the MCP servers, or Docker.

**Models.** Every `config_suggest_*.yaml` lists the same five, by provider-prefixed ID. BYOK (bring your own key) means a user who adds their own provider API key in Settings → AI Configuration and may then pick any model the app lists; without a key, suggestions use the platform default.

| Model | Why it is in the run |
|---|---|
| `openai/gpt-6-luna` | The platform default for suggestions |
| `gemini/gemini-3.5-flash-lite` | The Google budget model a BYOK user can pick |
| `anthropic/claude-haiku-5-5` | The Anthropic budget model a BYOK user can pick |
| `openai/gpt-5.4-nano` | Baseline: the previous platform default. OpenAI shuts it down on 2027-04-01, so it has to leave the configs before then. |
| `anthropic/claude-haiku-4-5` | Baseline: the previous Anthropic budget model |

Each call goes through `LLMService.complete()`, so every model gets its production request settings (`_MODEL_REQUEST_SETTINGS` in `backend/src/services/llm_service.py`) at `DEFAULT_TEMPERATURE`; the configs carry no temperature. Each result records what was sent as `temperature` (`null` when the model's entry omits it) and `request_settings`.

**Judge.** `openai/gpt-5.4-mini` (`eval.judge_model` in each config) scores the `llm_judge` checks at temperature 0, through the same settings helper. Keep it fixed when comparing models, so that score changes come from the models under test.

**Pass threshold.** Each test case runs 10 samples (`eval.samples`) and passes when at least 8 pass (`eval.pass_threshold: 0.8`).

**Running.** Run the suites one at a time, each with its own make target, then lint by hand: `ruff` runs on `evals/` only as the first step of `make evals` (which runs every eval, MCP included), not in the per-suite targets or `make backend-verify`.

```bash
make evals-ai-suggestions-tags
make evals-ai-suggestions-metadata
make evals-ai-suggestions-relationships
make evals-ai-suggestions-prompt-arguments
make evals-ai-suggestions-prompt-argument-fields
uv run ruff check evals
```

Don't use the combined `make evals-ai-suggestions` target: it runs all five suites in one pytest process, which can exhaust file descriptors on macOS (see the comment above the eval targets in the `Makefile`). Each suite writes one result file per model to `evals/ai_suggestions/results/`. A full run of all five suites costs about $2.50: the 2026-10-20 run cost $2.52, of which $0.67 was suggestion calls and $1.85 was the judge.

**Comparing a candidate with the current default.** Compare pooled pass rates per suite, not test cases one by one. A suite's pooled pass rate for a model is the sum of `passed` over the sum of `total` across `metadata._test_results.per_test_case` in that model's result file (60 to 110 samples per suite). A per-case comparison is too noisy: with 6 to 11 cases per suite and a case passing at 8 of 10 samples, two equally good models differ on at least one suite about 73% of the time (a binomial estimate). The rule used for the 2026-10-20 default change: if the candidate's pooled pass rate is more than 5 percentage points below the current default's on any suite, stop and report the numbers before changing the default.

Check slow calls as well as pass rates. The evals allow 60 s per attempt and 3 retries (`EVAL_LLM_TIMEOUT` and `EVAL_LLM_NUM_RETRIES` in `helpers.py`), while the suggestion endpoints allow 15 s and none. So a call that takes longer than 15 s passes here but times out in production. The result files record each call's duration.

## Viewing Results

Each run writes a timestamped JSON file to `evals/<suite>/results/` containing every sample's prompt, tool predictions, tool results, check outcomes, and tracebacks. The eval viewer is a local web UI for browsing those files — use it to inspect individual failures, compare runs across models, and diagnose why a check failed.

```bash
# One-time setup
make eval-viewer-install

# Start the viewer (opens a local web app)
make eval-viewer
```

## Directory Structure

```
evals/
├── README.md                           # This file
├── conftest.py                         # Shared pytest fixtures
├── utils.py                            # Shared helper functions
├── ai_suggestions/                     # AI suggestion endpoint evals (see "AI Suggestion Evaluations")
├── content_mcp/                        # Content MCP server evals
│   ├── config_edit_content.yaml        # edit_content test cases
│   ├── test_edit_content.py            # edit_content eval tests
│   ├── config_update_item.yaml         # update_item test cases
│   ├── test_update_item.py             # update_item eval tests
│   └── schema_snapshot.py              # Utility: dump tools/list JSON for pre/post-upgrade diffing
├── prompt_mcp/                         # Prompt MCP server evals
│   ├── config_edit_prompt_content.yaml # edit_prompt_content test cases
│   ├── test_edit_prompt_content.py     # edit_prompt_content eval tests
│   ├── config_update_prompt.yaml       # update_prompt test cases
│   └── test_update_prompt.py           # update_prompt eval tests
└── viewer/                             # Local web UI for browsing eval results (make eval-viewer)
```

## Configuration (MCP server evals)

Each MCP eval suite has a `config.yaml` that defines (the AI suggestion configs differ; see [AI Suggestion Evaluations](#ai-suggestion-evaluations)):

### Model Configuration
```yaml
model:
  provider: "anthropic"  # "anthropic" or "openai"
  name: "claude-haiku-4-5"
  temperature: 0  # Use 0 for reproducibility
```

### Evaluation Parameters
```yaml
eval:
  samples: 5              # Number of times to run each test case
  pass_threshold: 0.8  # Minimum pass rate (80%)
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

## Utility Scripts

### `content_mcp/schema_snapshot.py`

Dumps the Content MCP server's advertised `tools/list` output (tool names,
descriptions, input schemas, annotations) to stdout as sorted JSON. Intended
for diffing **before and after** a `fastmcp` upgrade (or any change that
might alter how tool metadata is serialized) to catch LLM-visible drift that
unit tests cannot detect.

```bash
# On the current fastmcp version
uv run python evals/content_mcp/schema_snapshot.py > /tmp/before.json

# After upgrading (e.g., `uv lock --upgrade-package fastmcp && uv sync`)
uv run python evals/content_mcp/schema_snapshot.py > /tmp/after.json

diff -u /tmp/before.json /tmp/after.json
```

An empty diff is a strong signal that the eval suite should behave the same
on the new version. A non-empty diff is not necessarily a regression, but
must be inspected.

## How It Works

The eval framework uses `flex-evals` with pytest:

1. **Test cases** are loaded from YAML and converted to `TestCase` objects
2. **Checks** are loaded from YAML and converted to `Check` objects using `get_check_class()`
3. The `@evaluate` decorator runs each test case `samples` times
4. Each run creates content, gets an LLM prediction, executes the tool, and cleans up
5. Checks validate the results using JSONPath expressions
6. The test passes if `pass_threshold` of samples pass all checks

## Debugging

If evaluations fail, check:

1. **MCP servers running**: Ensure both API and MCP servers are up
2. **API key valid**: Check the API key in `.env` matches the provider in your eval config (e.g., `ANTHROPIC_API_KEY` for Anthropic, `OPENAI_API_KEY` for OpenAI)
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
