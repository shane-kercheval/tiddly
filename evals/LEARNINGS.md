# Eval Learnings

Distilled insights from iterating on MCP tool descriptions and eval checks. Organized by topic with dated entries so it doubles as a changelog.

## Tool Description Patterns

### 2026-02-22: A concrete example fixed Haiku's multi-call failure

**Problem:** Haiku was making two `edit_prompt_content` calls instead of one when removing a variable — first call edited the template content (without the `arguments` parameter), second call tried to edit the arguments as if they were template text. The `remove-variable` test case was at **0% pass rate**.

**Root cause:** The tool description said "pass the arguments parameter in this same tool call" but lacked a concrete example showing what that looks like. The specification was technically correct but not actionable enough for Haiku.

**Fix:** Added a concrete example directly in the tool description:

```yaml
Example — removing {{ city }} from a template while keeping {{ name }}:
  name: "my-prompt"
  old_str: ", welcome to {{ city }}"
  new_str: ""
  arguments: [{"name": "name", "description": "User name", "required": true}]
```

**Result:** `remove-variable` went from 0% to 100%, and all other test cases (add-variable, rename-variable, simple-edit, remove-one-of-many) also hit 100%. The example taught the pattern once and it generalized.

**Takeaway:** When a model repeatedly misuses a tool despite correct specification text, add a concrete example showing the exact failure scenario. Examples > specification prose for teaching tool usage patterns.

### 2026-02-22: Instructions file — less is more

**Before:** 89-line instructions file with 10 example workflows and verbose tool descriptions. **After:** 29 lines with focused rules.

The verbose workflows were actually muddying tool choice — too many examples of "how to use tool X" without clearly stating the core rules (atomicity, full replacement semantics). Cutting to the essential rules improved results.

**Takeaway:** For LLM tool instructions, prioritize clear rules over comprehensive examples. Redundancy between tool descriptions and instructions can confuse rather than reinforce.

### 2026-02-22: Action verbs in tool descriptions improve tool selection

Changed `update_prompt` description from generic ("Update metadata and/or fully replace template content") to action-verb-driven ("Rewrite, restructure, or fully replace a prompt's template content"). This helped the model correctly choose between `edit_prompt_content` and `update_prompt`.

**Takeaway:** Frame tool descriptions around the *verbs users would use in their instructions* — the model matches instruction language to tool descriptions.

## Eval Check Patterns

### 2026-02-22: Added prediction_count and argument_descriptions checks

After fixing the multi-call failure, we added two checks to catch regressions:

- **`prediction_count`** — Verifies exactly 1 tool call. Catches the two-call failure mode directly rather than inferring it from wrong content/arguments. Makes failures immediately diagnosable.
- **`argument_descriptions`** — Verifies unchanged argument descriptions are preserved exactly. We were only checking argument *names*, which meant a model could pass by inventing new descriptions. Uses a shared `check_argument_descriptions_preserved()` helper in `evals/utils.py`.

Both checks are in `config_edit_prompt_content.yaml` and `config_update_prompt.yaml`. The corresponding tool descriptions also got "Preserve existing argument descriptions exactly" guidance.

**Takeaway:** When you fix a failure mode, add a check that catches it directly. Don't rely on downstream checks (content correctness) to catch upstream problems (wrong number of calls).
