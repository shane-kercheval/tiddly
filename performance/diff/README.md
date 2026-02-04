# Diff-Match-Patch Benchmark

Measures diff-match-patch algorithm performance for content versioning scenarios.

## Purpose

- Determine if diff computation is fast enough for synchronous API operations
- Find content size thresholds where performance degrades
- Test event loop impact of CPU-bound diff work

## What It Tests

1. **Diff Computation** (`patch_make`)
   - 1% changes (small edit, e.g., fixing a typo)
   - 10% changes (medium edit, e.g., rewriting a paragraph)
   - 50% changes (large rewrite)
   - Content sizes: 1KB to 500KB

2. **Reconstruction** (applying sequential diffs)
   - Apply 1-50 diffs to reconstruct content
   - Tests snapshot interval trade-offs

3. **Event Loop Impact**
   - How blocking diff computation affects concurrent async operations
   - Measures degradation factor

## Requirements

```bash
uv add diff-match-patch  # If not already installed
```

## Usage

```bash
uv run python performance/diff/benchmark.py
```

## Output

Markdown report saved to `performance/diff/results/` including:

- P50, P95, P99, Max latency for each scenario
- Decision matrix with recommendations
- Thresholds for when to use snapshots vs diffs

## Key Findings

From typical runs:
- **1-10% changes**: Sub-millisecond for content up to 100KB
- **50% changes**: Becomes slow (>50ms) around 50KB+
- **Reconstruction**: Always fast (<1ms even for 50 diffs)
