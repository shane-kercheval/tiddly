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

## Tag Suggestion Prompts

### 2026-04-11: Few-shot examples can hurt more than they help

**Problem:** The tag suggestion prompt included 10 few-shot examples (recent user items with their tags) to teach "tagging style." The budget model (gemini-2.5-flash-lite) consistently suggested irrelevant tags like `python` for a Docker Compose note and `api` for web scraping content.

**Root cause:** The few-shot examples had a Python-heavy distribution (4/10 examples included `python`). Combined with `python` being the #1 tag in the vocabulary (count: 47), the model learned "this user tags everything with python" and applied it indiscriminately. The examples created a recency/frequency bias that reinforced the vocabulary frequency signal.

**Fix:** Removed few-shot examples entirely. The vocabulary alone (tag names + usage counts) provides enough context for the model to suggest relevant tags in the right format.

**Result:** `devops-docker-note` improved from 0/10 to 2/10 on flash-lite and 5/10 to 10/10 on haiku. `machine-learning-paper` went from 6/10 to 10/10 on flash-lite. Overall haiku pass rate improved from 5/10 to 7/10 samples.

**Takeaway:** Few-shot examples are not always beneficial. When examples have skewed distributions (common in real user data), they can teach the model to over-index on patterns rather than evaluate each item independently. Test with and without examples — vocabulary + clear guidelines may be sufficient.

### 2026-04-11: Budget models have stronger vocabulary frequency bias

**Problem:** gemini-2.5-flash-lite consistently suggests high-frequency vocabulary tags (`python`, `api`) even for unrelated content. claude-haiku-4-5 follows the "only suggest directly supported tags" guideline much more reliably.

**Observation:** Both models receive the same prompt. The guideline "Only suggest tags that are directly supported by the item's title, description, or content" works well for haiku but flash-lite still over-indexes on vocabulary frequency. This is a model capability gap, not a prompt issue.

**Takeaway:** Run evals on multiple models to distinguish prompt issues from model limitations. If a stronger model passes but a weaker one fails with the same prompt, the prompt is likely fine — the budget model just can't follow complex instructions as reliably.

### 2026-04-11: Judge must see the same context as the model under test

**Problem:** The LLM judge was failing tags like `aws` as irrelevant, even though the content explicitly mentioned "deployment to AWS." The judge was evaluating with only title + description, missing the content snippet.

**Fix:** Added content_snippet and URL to the judge prompt template. Pass rate for `python-flask-tutorial` went from 0/10 to 10/10 immediately.

**Takeaway:** Always verify context parity between the model under test and the judge. If the judge sees less context, it will flag tags as irrelevant that are actually supported by fields it can't see.
