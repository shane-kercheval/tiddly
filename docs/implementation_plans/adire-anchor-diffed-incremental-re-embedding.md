# Anchor-Diffed Incremental Re-Embedding (ADIRE)

## Status: Draft / Future Consideration

This document captures ADIRE — an approach for minimizing unnecessary re-embedding when document content changes. Structural content units serve as stable anchors; diffing the anchor sequences between versions identifies which chunks are affected by an edit, and only those chunks are re-embedded. It is not part of the current implementation plan — the initial embedding pipeline will use a simpler approach (document-level hash check + full re-embed on change). This is documented here for future evaluation, potential proof of concept, or white paper.

## Problem

When a user edits a document, the naive approach is to delete all chunks, re-chunk, and re-embed everything. This works but is wasteful when:

- The edit is small (added a paragraph, fixed a section)
- The document is large (many chunks, most unchanged)

The standard optimization — hash each chunk's text and skip unchanged chunks — breaks down with greedy combining. Inserting content early in the document shifts all subsequent chunk boundaries via cascade, making every downstream chunk hash different even though the underlying content units are the same.

## Anchor Units

ADIRE is parameterized by the choice of **anchor unit** — the structural content boundary used for identity tracking and diffing. The anchor unit is a tuning parameter, not a fixed part of the algorithm. Any consistent structural boundary works:

- **Paragraphs** (`\n\n` separated) — the default for prose-based content
- **Lines** (`\n` separated) — for bullet-heavy content, code, or logs
- **Sections** (heading-delimited) — for highly structured documents
- **Application-defined blocks** — some editors (Notion, block-based note apps) have their own concept of content blocks/widgets that are natural anchors

The anchor unit should be **smaller than a chunk** (so multiple anchors combine into one chunk) and **structurally stable** (so edits within one anchor don't shift others). The rest of this document uses paragraphs as the anchor unit, but the algorithm applies to any choice.

### Why paragraphs are a good default

Paragraphs are a natural boundary for both chunking and change detection because they're small enough to be precise but large enough to combine efficiently into chunks. Typical sizes across document types:

| Document type | Chars/paragraph | Tokens/paragraph (~4 chars/token) | Paragraphs per 512-token chunk |
|---|---|---|---|
| Novel / long-form prose | 400-600 | 100-150 | 3-5 |
| Technical doc / white paper | 600-1000 | 150-250 | 2-3 |
| Blog post | 300-500 | 75-125 | 4-7 |
| User notes (mixed bullets + prose) | Highly variable (20-800) | 5-200 | Variable |

At 512 tokens per chunk with greedy combining, most document types produce chunks of 2-5 paragraphs — granular enough for precise change detection while keeping chunk count manageable. The greedy combining step handles the variable case (user notes with short bullets): many small paragraphs get combined into a single chunk, so a table of contents with 30 bullet points becomes 1-2 chunks, not 30.

For large notes (the primary use case for this optimization), expected paragraph and chunk counts at different document sizes:

| Note size | Tokens | Chunks (512 tok) | Technical/prose (~800 chars/para) | Mixed bullets+prose (~400 chars/para) | Bullet-heavy (~150 chars/para) |
|---|---|---|---|---|---|
| 50K chars | ~12.5K | ~24 | ~63 paras | ~125 paras | ~333 paras |
| 75K chars | ~18.8K | ~37 | ~94 paras | ~188 paras | ~500 paras |
| 100K chars | ~25K | ~49 | ~125 paras | ~250 paras | ~667 paras |

Token and chunk counts depend on total document size, not content type. What varies is the **number of paragraphs** — which determines the granularity of change detection. A mixed-content 100K note has ~250 paragraphs across ~49 chunks (~5 paragraphs per chunk), meaning a single paragraph edit dirties only ~1 of 49 chunks (~2%).

For a note-taking app, "mixed bullets+prose" is the most realistic average: ~2-3 paragraphs per 1K characters.

## Core Idea

Track anchor unit identity separately from chunk grouping. Diff the old and new anchor hash sequences to identify which existing chunks contain changed, inserted, or removed anchors. Only re-chunk and re-embed the affected chunks. Unchanged chunks are preserved by design, not by coincidence.

## Data Model

Each chunk stores:
- `chunk_index` — position in the document (for ordering)
- `chunk_text` — the combined paragraph text
- `embedding` — the vector
- `paragraph_hashes` — ordered list of hashes of the individual paragraphs composing this chunk (e.g., `["aa11", "bb22"]`)

Each paragraph hash is computed from the paragraph's normalized text (consistent whitespace handling). SHA-256 truncated to 16 hex chars is sufficient for collision avoidance at this scale.

The chunk structure is also stored (or derivable from the chunks table):
- The ordered list of all paragraph hashes across the document
- Which paragraph hashes belong to which chunk

## Algorithm

The key insight: **unchanged chunks are never re-chunked or re-embedded.** We diff paragraph hashes to find which chunks are affected by the edit, extract only the affected region, re-chunk that region, and splice the results back in.

```
FUNCTION incremental_embed(entity, new_content):

    # ---------------------------------------------------------------
    # Step 0: Document-level fast path
    # ---------------------------------------------------------------
    new_body_hash = hash(new_content)
    IF new_body_hash == entity.body_hash:
        RETURN  # Nothing changed at all

    # ---------------------------------------------------------------
    # Step 1: Split new content into paragraphs and hash each one
    # ---------------------------------------------------------------
    new_paragraphs = split_on_double_newline(new_content)
    new_para_hashes = [hash(p.text) for p in new_paragraphs]

    # ---------------------------------------------------------------
    # Step 2: Load existing chunk structure
    # ---------------------------------------------------------------
    old_chunks = load_existing_chunks(entity.id)
    # Each old_chunk has: chunk_index, paragraph_hashes, embedding

    # Build the old paragraph hash sequence from chunk structure
    old_para_hashes = []
    for chunk in old_chunks:
        old_para_hashes.extend(chunk.paragraph_hashes)

    # ---------------------------------------------------------------
    # Step 3: Diff old vs new paragraph hash sequences
    # ---------------------------------------------------------------
    # Use a sequence diff (like difflib.SequenceMatcher or similar)
    # to identify which paragraph hashes were added, removed, or changed.
    #
    # The diff produces operations like:
    #   EQUAL   [aa11, bb22]          — unchanged paragraphs
    #   INSERT  [xx99]                — new paragraph inserted
    #   DELETE  [old_hash]            — paragraph removed
    #   REPLACE [dd44] -> [dd44_v2]   — paragraph content changed

    diff_ops = diff(old_para_hashes, new_para_hashes)

    # ---------------------------------------------------------------
    # Step 4: Map changed paragraphs back to affected chunks
    # ---------------------------------------------------------------
    # For each diff operation that is not EQUAL, find which old chunk(s)
    # contain the affected paragraph hashes. Those chunks are "dirty."
    #
    # Build a lookup: paragraph_hash -> chunk_index
    para_to_chunk = {}
    for chunk in old_chunks:
        for ph in chunk.paragraph_hashes:
            para_to_chunk[ph] = chunk.chunk_index

    dirty_chunk_indices = set()
    for op in diff_ops:
        if op.type != EQUAL:
            # For deletions and replacements, mark the old chunk as dirty
            for ph in op.old_hashes:
                dirty_chunk_indices.add(para_to_chunk[ph])
            # For insertions, mark the chunk adjacent to the insertion point
            if op.type == INSERT:
                adjacent_chunk = find_chunk_at_position(op.position, old_chunks)
                dirty_chunk_indices.add(adjacent_chunk.chunk_index)

    # ---------------------------------------------------------------
    # Step 5: Preserve unchanged chunks, re-chunk only dirty regions
    # ---------------------------------------------------------------
    # Walk through old chunks in order. Unchanged chunks are kept as-is.
    # Consecutive dirty chunks are merged into a "dirty region" — their
    # paragraphs (with insertions/changes applied) are re-chunked together.

    new_chunk_list = []

    i = 0
    while i < len(old_chunks):
        if old_chunks[i].chunk_index not in dirty_chunk_indices:
            # Unchanged chunk — keep embedding, update index
            new_chunk_list.append({
                action: KEEP,
                chunk: old_chunks[i],
            })
            i += 1
        else:
            # Start of a dirty region — collect consecutive dirty chunks
            dirty_region_paras = []
            while i < len(old_chunks) and old_chunks[i].chunk_index in dirty_chunk_indices:
                i += 1

            # Gather the NEW paragraphs that correspond to this region
            # (using the diff to know what replaced the old paragraphs)
            region_new_paras = get_new_paragraphs_for_dirty_region(diff_ops, region_bounds)

            # Re-chunk only this region using greedy paragraph combining
            re_chunked = greedy_chunk(region_new_paras, MAX_CHUNK_TOKENS)

            for rc in re_chunked:
                new_chunk_list.append({
                    action: EMBED,
                    text: rc.text,
                    paragraph_hashes: rc.paragraph_hashes,
                })

    # Handle any new paragraphs appended at the end of the document
    # (insertions after the last old chunk)
    trailing_new_paras = get_trailing_insertions(diff_ops)
    if trailing_new_paras:
        re_chunked = greedy_chunk(trailing_new_paras, MAX_CHUNK_TOKENS)
        for rc in re_chunked:
            new_chunk_list.append({ action: EMBED, ... })

    # ---------------------------------------------------------------
    # Step 6: Execute changes
    # ---------------------------------------------------------------
    DELETE all old chunks for this entity
    # (simpler than surgical updates; chunk count may have changed)

    for i, item in enumerate(new_chunk_list):
        if item.action == KEEP:
            INSERT chunk with old embedding, new chunk_index = i
        elif item.action == EMBED:
            # Batch these for one API call
            queue_for_embedding(item, chunk_index = i)

    embeddings = embedding_api.embed_batch(queued_texts)
    INSERT new chunks with embeddings

    UPDATE entity.body_hash = new_body_hash
```

## Walkthrough Example

### Initial state

A document with 6 paragraphs (token counts shown):

```
Para A: "How to deploy to Railway..."         (180 tokens)  hash=aa11
Para B: "First, create a new project..."      (200 tokens)  hash=bb22
Para C: "Configure your environment..."       (250 tokens)  hash=cc33
Para D: "Next, connect your GitHub repo..."   (190 tokens)  hash=dd44
Para E: "Finally, set up your domain..."      (300 tokens)  hash=ee55
Para F: "For monitoring, Railway provides..."  (200 tokens)  hash=ff66
```

Greedy combining at 512-token limit produces 3 chunks:

```
Chunk 0: [A + B] = 380 tokens    paragraph_hashes: [aa11, bb22]    → embedded
Chunk 1: [C + D] = 440 tokens    paragraph_hashes: [cc33, dd44]    → embedded
Chunk 2: [E + F] = 500 tokens    paragraph_hashes: [ee55, ff66]    → embedded
```

Stored paragraph hash sequence: `[aa11, bb22, cc33, dd44, ee55, ff66]`

### Edit: User inserts a new paragraph after B AND edits paragraph D

New content produces these paragraphs:

```
Para A:   hash=aa11     (unchanged)
Para B:   hash=bb22     (unchanged)
Para NEW: hash=xx99     ← INSERTED (150 tokens)
Para C:   hash=cc33     (unchanged)
Para D':  hash=dd44_v2  ← CHANGED (was dd44, user edited the text)
Para E:   hash=ee55     (unchanged)
Para F:   hash=ff66     (unchanged)
```

New paragraph hash sequence: `[aa11, bb22, xx99, cc33, dd44_v2, ee55, ff66]`

### Step 3: Diff the paragraph hash sequences

```
Old: [aa11, bb22,             cc33, dd44,     ee55, ff66]
New: [aa11, bb22, xx99,       cc33, dd44_v2,  ee55, ff66]
                  ^^^^              ^^^^^^^^
                  INSERT            REPLACE

Diff operations:
  EQUAL   [aa11, bb22]
  INSERT  [xx99]              ← new paragraph
  EQUAL   [cc33]
  REPLACE [dd44] → [dd44_v2] ← changed paragraph
  EQUAL   [ee55, ff66]
```

### Step 4: Map changes to affected chunks

```
Paragraph → Chunk mapping:
  aa11 → chunk 0
  bb22 → chunk 0
  cc33 → chunk 1
  dd44 → chunk 1
  ee55 → chunk 2
  ff66 → chunk 2

INSERT xx99: inserted after bb22 (chunk 0), adjacent to cc33 (chunk 1) → chunk 1 is dirty
REPLACE dd44 → dd44_v2: dd44 is in chunk 1 → chunk 1 is dirty

Dirty chunks: {1}
Unchanged chunks: {0, 2}
```

Both changes land in the same chunk. Only chunk 1 is affected.

### Step 5: Re-chunk the dirty region

```
Unchanged:  Chunk 0 [A + B]  → KEEP (embedding preserved)

Dirty region — old chunk 1 contained [cc33, dd44].
New paragraphs for this region (with insertions and changes applied):
  [xx99 (150 tokens), cc33 (250 tokens), dd44_v2 (190 tokens)]

Greedy re-chunk this region:
  New chunk 1: [xx99 + cc33] = 400 tokens  → EMBED
  New chunk 2: [dd44_v2]     = 190 tokens  → EMBED

Unchanged:  Chunk 2 [E + F]  → KEEP (embedding preserved, index updates to 3)
```

### Final result

```
Chunk 0: [A + B]       paragraph_hashes: [aa11, bb22]      → KEPT (old embedding)
Chunk 1: [NEW + C]     paragraph_hashes: [xx99, cc33]      → NEW (embedded)
Chunk 2: [D']          paragraph_hashes: [dd44_v2]         → NEW (embedded)
Chunk 3: [E + F]       paragraph_hashes: [ee55, ff66]      → KEPT (old embedding)
```

**Chunks 0 and 3 were never touched — their embeddings are preserved by design, not by coincidence. Only the 2 chunks in the dirty region needed API calls.**

## Fragmentation and Defragmentation

Over time, incremental re-chunking can produce suboptimal chunk sizes. In the example above, chunk 2 (`[dd44_v2]`) is only 190 tokens — well below the 512-token target. Repeated small edits can accumulate these "fragment" chunks.

### Strategy A: Defrag on threshold (recommended)

Let fragments accumulate. Before running the incremental algorithm, check the document's chunk quality. If it has degraded past a threshold, skip incremental entirely and do a full re-chunk from scratch.

```
FUNCTION should_defrag(old_chunks) -> bool:
    if not old_chunks:
        return False

    small_chunk_count = count(c for c in old_chunks if c.token_count < MIN_CHUNK_THRESHOLD)
    fragment_ratio = small_chunk_count / len(old_chunks)

    return fragment_ratio > MAX_FRAGMENT_RATIO
```

Suggested starting values (need experimentation):
- `MIN_CHUNK_THRESHOLD`: 25% of target chunk size (128 tokens for a 512 target)
- `MAX_FRAGMENT_RATIO`: 30% of chunks are below the minimum

When defrag triggers, the algorithm falls back to: delete all chunks, re-chunk from scratch, re-embed everything. This is the same as the baseline approach — simple and correct.

**Advantages:**
- Two clean codepaths (incremental vs. full), no hybrid logic
- Fragmentation may be rare in practice — most edits either change text within a paragraph (no structural change) or add/remove whole sections
- The defrag check is a single query before entering the algorithm

### Strategy B: Fix as you go (not recommended)

After re-chunking a dirty region, check if any resulting chunks are too small. If a small chunk is adjacent to a kept chunk that has room, absorb the small chunk into the neighbor (which then needs re-embedding since its content changed). If a chunk is too large, split it.

**Why this is worse:**
- Absorbing into a neighbor changes that neighbor's content, requiring re-embedding — a localized cascade of the same problem we're trying to avoid
- Edge cases compound: which neighbor (left or right)? What if both are near the limit? What if the small chunk is between two kept chunks?
- More complex code with more re-embedding than expected

## When This Approach Adds Value

The simpler approach (document-level hash + full re-embed on any change) costs ~$0.0005 for the largest possible note (100K chars, ~49 chunks at 512 tokens). ADIRE saves a fraction of that per edit.

### Where incremental re-embedding helps

- **Latency**: Fewer chunks to embed = faster worker turnaround. Even though the user doesn't wait (async worker), matters if the worker is under load processing many jobs.
- **Rate limits**: Fewer API calls during burst traffic (many users editing simultaneously).
- **Scale**: At high user counts with large documents, cumulative savings in API calls could matter.
- **Future model costs**: If we switch to a more expensive embedding model, per-chunk savings become more meaningful.

### Outstanding questions

**When to activate this vs. the simple approach:**

ADIRE adds complexity (~50-80 lines of diff and region logic, paragraph hash storage). It may not be worth activating for small documents where full re-embedding is near-instant.

- **Document size threshold**: Only use for documents above a certain size? e.g., 50K characters (~100 chunks). Below that, full re-embed is cheap.
- **Chunk count threshold**: Trigger when a document produces more than N chunks (e.g., 20+)? Adapts naturally to chunk size configuration.
- **Always-on vs. conditional**: The algorithm's overhead is small even for short documents (hashing paragraphs + sequence diff). It might be simpler to always use it than maintain two codepaths. Needs benchmarking.
- **Paragraph structure quality**: Documents with very few paragraph breaks (e.g., parsed PDFs as one text blob) won't benefit — most content ends up in fixed-size splits that cascade anyway. Should we detect this and fall back? What heuristic? Average paragraph size? Paragraph count relative to document length?

**Defrag tuning:**

- What are the right values for `MIN_CHUNK_THRESHOLD` and `MAX_FRAGMENT_RATIO`?
- How often does fragmentation actually occur with real user editing patterns?
- Should defrag be proactive (check on every save) or reactive (periodic background job)?

These questions are best answered with real data once the basic embedding pipeline is running.

## Comparison to Other Approaches

| Approach | Behavior on paragraph insert at top | Unchanged chunks preserved? | Complexity |
|----------|--------------------------------------|----------------------------|------------|
| Naive (delete all, re-embed all) | Re-embeds all chunks | No | Trivial |
| Content hash per chunk (re-chunk from scratch, hash-match) | Re-embeds most chunks (cascade shifts boundaries; may salvage tail chunks by coincidence) | By coincidence only | Low |
| **ADIRE** (this doc) | Re-embeds only chunks containing changed/inserted paragraphs | Yes, by design | Medium |
| Content-defined chunking (rolling hash, a la Xet) | Re-embeds only chunks near the edit | Yes, by design | High |

Content-defined chunking (CDC) uses a rolling hash to create boundaries that are inherently stable — insertions only affect nearby boundaries. It's the most cascade-resistant approach but is significantly more complex to implement and harder to reason about. ADIRE gets most of the benefit with less complexity by leveraging natural document structure.

## References

- [Content-Defined Chunking (Hugging Face Xet)](https://huggingface.co/docs/xet/en/chunking) — rolling hash approach for stable chunk boundaries
- [FastCDC (USENIX ATC 2016)](https://www.usenix.org/system/files/conference/atc16/atc16-paper-xia.pdf) — canonical paper on high-performance content-defined chunking
- [Vectara NAACL 2025](https://arxiv.org/pdf/2410.13070) — chunking configuration impact on retrieval quality
- [LlamaIndex IngestionPipeline](https://docs.llamaindex.ai/en/stable/examples/ingestion/document_management_pipeline/) — document-level hash tracking for skip-if-unchanged
- [Pinecone - Update Data](https://docs.pinecone.io/guides/data/update-data) — standard industry approach (delete all chunks, re-ingest)
- `docs/implementation_plans/pgvector-embeddings.md` — parent implementation plan (Milestone 2: Chunking Service, Milestone 4: Async Worker)

---

## Appendix A: Why This Problem Is Largely Unaddressed

Most RAG systems don't solve incremental re-embedding because most RAG use cases are ingest-heavy, not edit-heavy. Typical workloads — knowledge bases, documentation sites, scraped web pages, PDF collections — involve embedding documents once and rarely modifying them. When a document does change, it's usually a full version replacement (new PDF uploaded, page republished), not incremental edits.

Pinecone, Weaviate, Qdrant, Milvus, and Chroma all recommend the same approach when a document changes: delete all its chunks and re-ingest. No major vector database or RAG framework implements sub-document change detection.

**LlamaIndex's IngestionPipeline** is the most sophisticated mainstream approach. It tracks a document-level hash and skips unchanged documents entirely. It also caches `(chunk text hash → embedding)` pairs, so if a re-chunked chunk happens to produce identical text, the embedding is served from cache. But it does not do paragraph-level diffing or stable boundary detection — if anything in the document changed, the entire document is re-chunked.

A note-taking app with semantic search is an unusually edit-heavy use case. Users may edit the same note dozens of times per day, and the notes can be large (up to 100K characters in Pro tier). This is the specific context where incremental re-embedding becomes worth considering.

## Appendix B: Content-Defined Chunking (CDC) — Deep Dive

CDC is a technique from the storage and deduplication world (rsync, restic, Xet/HuggingFace) that achieves stable chunk boundaries under edits. It is not currently used for embeddings, but the stability mechanism is instructive and directly analogous to ADIRE.

### How rolling hashes work

A rolling hash computes a hash over a sliding window of bytes. At each position in the document, the hash is updated incrementally (adding the new byte, removing the oldest — O(1) per step). When the hash meets a predetermined condition (e.g., the last 13 bits are all zeros), a chunk boundary is placed at that position.

```
Document bytes: [The quick brown fox jumped over the lazy dog and then...]
                 ←── window ──→
                 hash = 0x3A92F  → no match, slide forward
                  ←── window ──→
                  hash = 0x7B102 → no match, slide forward
                   ←── window ──→
                   hash = 0x1E000 → last 13 bits are zero → BOUNDARY
```

The boundary condition (e.g., "last 13 bits are zero") is tuned to produce the desired average chunk size. With 13 bits, a boundary occurs on average every 2^13 = 8192 bytes. Adjusting the bit count adjusts the chunk size.

### Why boundaries are stable under edits

The boundary decision at any position depends **only on the bytes inside the window at that position**, not on anything before or after it. This is the key property.

When you insert text at position 1000 in a document:

```
Before edit:
  ....[unchanged bytes]....[BOUNDARY]....[unchanged bytes]....[BOUNDARY]....
       positions 0-999      pos 1000      positions 1001-5000   pos 5001

After inserting 200 bytes at position 1000:
  ....[unchanged bytes]....[NEW TEXT (200 bytes)]....[disrupted]....[BOUNDARY]....[unchanged]....
       positions 0-999       positions 1000-1199      ~1200-1250    pos ~1250

  The rolling hash window slides through the new text, producing unpredictable
  hashes. But once the window moves past the insertion and back into the
  original unchanged bytes, the hashes are the same as before — because the
  window contents are the same. The rolling hash "re-synchronizes."

  Disruption zone ≈ window size (typically 48-256 bytes).
  Everything beyond that produces identical boundaries to the pre-edit version.
```

This means an insertion in the middle of a 100KB document disrupts at most 1-2 chunks near the edit point. All other chunks — potentially hundreds — remain byte-identical with the same boundaries.

### CDC vs. ADIRE: tradeoffs

| Property | CDC (rolling hash) | ADIRE (this doc) |
|----------|-------------------|-------------------------------|
| **Atomic unit** | Bytes (meaningless to humans) | Paragraphs (semantically meaningful) |
| **Boundary stability** | Mathematically guaranteed — disruption bounded to window size regardless of content structure | Depends on document having paragraph structure |
| **Works on structureless blobs** | Yes — works on any byte stream (PDFs, binary, anything) | Poorly — falls back to fixed-size splitting, losing stability benefits |
| **Semantic coherence** | None — chunks can split mid-sentence or mid-word, producing poor embeddings | High — chunks always align to paragraph boundaries |
| **Chunk size control** | Statistical — average size is controlled but individual chunks vary (typically 0.5x to 2x target) | Deterministic — greedy combining with a hard token budget |
| **Speed** | Very fast — O(n) single pass with bitwise operations | Fast — O(n) paragraph split + O(n) sequence diff |
| **Disruption on edit** | 1-2 chunks guaranteed, regardless of content | Typically 1 chunk if edit is within a paragraph; more if paragraph structure shifts |
| **Implementation** | Rolling hash math, window size tuning, boundary condition tuning | Paragraph hashing, sequence diff (e.g., difflib), dirty region mapping |

### Why CDC isn't the right choice for embeddings

CDC's strength — byte-level stability regardless of content structure — is also its weakness for embeddings. A chunk that starts at byte 8192 and ends at byte 16384 might split mid-sentence:

```
CDC chunk: "...the deployment process. Configure your environment variables by
           setting the following values in your Railway dashboard. The most
           important variable is DATABASE_URL whi"

Next chunk: "ch should point to your PostgreSQL instance. You can find this..."
```

This produces a poor embedding because the semantic unit is broken. For storage deduplication this doesn't matter (you're just comparing bytes). For embeddings, semantic coherence directly affects search quality.

A hybrid approach — CDC for boundary stability, snapped to the nearest paragraph or sentence break — would recover semantic coherence. But this adds complexity (CDC + snap logic + edge cases when the nearest paragraph break is far from the CDC boundary), and the resulting system is more complex than ADIRE while solving a problem (structureless text stability) that could also be handled by simply falling back to full re-embed for structureless documents.

### CDC in the broader landscape

- **rsync (1996)**: Original application — rolling checksums for efficient file synchronization
- **restic**: Backup tool using CDC for deduplication across snapshots
- **FastCDC (USENIX ATC 2016)**: Optimized CDC with gear-based rolling hash, ~10x faster than basic Rabin fingerprinting
- **Xet/HuggingFace**: Uses CDC for chunk-level deduplication of ML model files and datasets, achieving ~50% storage savings over Git LFS
- **Embeddings/RAG**: No known application of CDC. ADIRE documented here is the closest adaptation of CDC principles to the embedding domain.

## Appendix C: Proof of Concept — Simulation Design

Before building ADIRE into the production pipeline, we should validate the approach with a simulation that answers: **how much does this actually save, and does it affect search quality?**

### Algorithms to compare

1. **Naive (baseline)**: On every edit, discard all chunks and re-chunk/re-embed from scratch.
2. **Content-hash match**: Re-chunk from scratch, but hash each new chunk and skip embedding if an identical hash exists in the old chunks. This is the "hope for coincidental matches" approach — cascade-sensitive.
3. **ADIRE (this doc)**: Diff paragraph hashes, identify dirty chunks, re-chunk only the dirty region, preserve unchanged chunks by design.

### Metrics to collect

For each edit, per algorithm:

| Metric | What it measures | How to compute |
|---|---|---|
| **Chunks re-embedded** | Cost proxy (embedding API calls) | Count of chunks sent to embedding API |
| **Tokens re-embedded** | Cost proxy (API billing) | Sum of token counts for re-embedded chunks |
| **Chunks preserved** | Efficiency of the algorithm | Count of chunks reused without re-embedding |
| **Preservation rate** | Efficiency as a percentage | `chunks_preserved / total_chunks_after_edit` |
| **Fragment count** | Chunk quality degradation | Count of chunks below 25% of target size (128 tokens for 512 target) |
| **Fragment ratio** | Defrag trigger metric | `fragment_count / total_chunks` |

### Edit types to simulate

Each edit type should be tested at different positions in the document (near the top, middle, and bottom) since position affects cascade behavior:

| Edit type | Description | Expected impact |
|---|---|---|
| **Typo fix** | Change 5-10 characters within a paragraph | 1 paragraph hash changes, 1 chunk dirty |
| **Sentence addition** | Add 1-2 sentences to an existing paragraph | 1 paragraph hash changes, 1 chunk dirty |
| **Paragraph insert** | Insert a new paragraph (100-300 tokens) | Adjacent chunk dirty, possible re-grouping |
| **Paragraph delete** | Remove an existing paragraph | Adjacent chunks may re-group |
| **Section rewrite** | Replace 3-5 consecutive paragraphs with new content | Multiple consecutive chunks dirty |
| **Section insert** | Insert 3-5 new paragraphs as a block | 1-2 chunks dirty at insertion point |
| **Append at end** | Add 1-3 paragraphs at the end of the document | Only new/last chunk affected |
| **Scattered edits** | Change 1 paragraph in 3 different sections | 3 non-adjacent chunks dirty |

### Document corpus

Generate synthetic documents or use real anonymized notes to create a test corpus:

| Document profile | Size | Structure |
|---|---|---|
| Small prose note | 5K chars, ~12 paras | Paragraphs of 300-500 chars |
| Medium mixed note | 25K chars, ~60 paras | Mix of short bullets and prose paragraphs |
| Large technical note | 50K chars, ~125 paras | Sections with headings, paragraphs of 400-800 chars |
| Max-size note | 100K chars, ~250 paras | Mixed structure, representative of Pro tier power user |
| Structureless blob | 50K chars, ~5 paras | Parsed PDF or pasted content with minimal paragraph breaks |

The structureless blob is an important control — it tests the degenerate case where ADIRE has no advantage.

### Simulation procedure

```
FOR each document in corpus:
    initial_chunks = chunk_from_scratch(document)

    FOR each edit_type in edit_types:
        FOR each position in [top_10%, middle, bottom_10%]:
            FOR trial in range(100):  # statistical significance
                edited_doc = apply_random_edit(document, edit_type, position)

                # Run all three algorithms
                naive_result    = naive_rechunk(edited_doc)
                hash_result     = content_hash_rechunk(edited_doc, initial_chunks)
                anchored_result = paragraph_anchored_rechunk(edited_doc, initial_chunks)

                record_metrics(naive_result, hash_result, anchored_result)

                # For edit-chain simulation: use the result as input to next edit
                # (tests fragmentation accumulation)

    # Edit chain: 20 sequential edits on the same document
    current_doc = document
    current_chunks = initial_chunks
    FOR i in range(20):
        edit_type = random_choice(edit_types, weighted_by_realistic_frequency)
        current_doc = apply_random_edit(current_doc, edit_type)
        result = paragraph_anchored_rechunk(current_doc, current_chunks)
        current_chunks = result.new_chunks
        record_chain_metrics(i, result)  # track fragmentation over time
```

### Search quality validation

The efficiency simulation above doesn't require actual embedding API calls — it just counts which chunks would be re-embedded. But we also need to verify that preserved (non-re-embedded) chunks don't degrade search quality.

**Quality metrics to collect:**

| Metric | What it measures | How to compute |
|---|---|---|
| **Recall@K overlap** | Do the same chunks appear in the top K? | Intersection of top-K chunk sets between ADIRE and from-scratch, divided by K |
| **Rank correlation** | Are the chunks in the same order? | Spearman rank correlation between the two result lists |
| **Chunk size distribution divergence** | Has fragmentation skewed chunk sizes? | Compare mean/median/std of chunk token counts vs. from-scratch baseline |
| **Cohesion score** | Are chunks topically coherent? | Average pairwise cosine similarity of sentence embeddings within each chunk (higher = more focused) |
| **Fragment ratio** | How many chunks are undersized? | Count of chunks below 128 tokens / total chunks |

**Procedure (requires embedding API calls — run on a small subset):**

1. Take a document and run 10 sequential edits using ADIRE (some chunks preserved, some re-embedded, possible fragmentation).
2. Take the same final document and chunk from scratch (the "gold standard" chunking).
3. Embed both sets of chunks using the actual embedding API.
4. Run a set of 20-50 test queries against both chunk sets.
5. For each query, compare the top-5 retrieved chunks using Recall@K overlap and rank correlation.
6. Compute chunk-level metrics (size distribution, cohesion, fragment ratio) for both sets.

**Interpreting results:**

- Recall@5 overlap consistently above 80% → fragmentation isn't meaningfully affecting retrieval.
- Rank correlation above 0.9 → the ordering is effectively identical.
- If either metric drops below those thresholds, the defrag threshold needs to be more aggressive — or the incremental approach produces chunks that are "technically different" in ways that matter to search.
- Compare cohesion scores: if ADIRE chunks have lower cohesion than from-scratch, the dirty-region re-chunking is producing poorly-bounded chunks (unlikely since we still use paragraph boundaries, but worth verifying).

### Expected outcomes

**Hypothesis:** For typical edits (typo, sentence add, paragraph insert), ADIRE preserves 80-95% of chunks. Content-hash matching preserves 30-60% (cascade-dependent). Naive preserves 0%.

**What would make ADIRE not worth it:**
- If most real edits are "section rewrite" type (touching many consecutive paragraphs), the preservation rate drops and the complexity isn't justified.
- If the structureless blob case is common (many documents have no paragraph structure), the approach degrades to naive for a significant portion of content.
- If search quality testing shows that fragmented chunks noticeably hurt retrieval, the defrag threshold would need to be aggressive enough that most edits trigger a full re-chunk anyway.

**What would confirm it's worth building:**
- Preservation rate consistently above 70% for common edit types on documents with 20+ chunks.
- Edit chains of 20 edits maintain fragment ratio below the defrag threshold.
- Search quality is indistinguishable from from-scratch chunking.

### Implementation notes

The simulation can be built as a standalone Python script with no external dependencies beyond `difflib` (for sequence matching) and a tokenizer (tiktoken or approximate char/4). No embedding API calls needed for the efficiency simulation — only for the search quality validation step, which runs on a small subset.

Estimated implementation effort: ~200-300 lines of Python. Runtime: minutes (all local computation except the search quality subset).

## Appendix D: Chunking Evaluation Metrics — Reference

This appendix documents the standard metrics and methodologies used to evaluate chunking strategies for RAG systems. These apply broadly — not just to ADIRE, but to any chunking strategy decisions (size, overlap, boundary type, etc.).

### Retrieval metrics

These measure whether the chunking strategy produces chunks that surface correctly in search results. The embedding model, query set, and retrieval parameters are held constant; only the chunking strategy varies.

| Metric | What it measures | When to use |
|---|---|---|
| **Recall@K** | Of all relevant chunks, how many appeared in the top K results? | Primary metric — missing a relevant chunk is worse than including an irrelevant one in RAG, since the LLM can ignore noise but can't recover missing context |
| **Precision@K** | Of the top K results, how many are relevant? | Less critical for RAG (LLMs tolerate some noise), but useful for measuring retrieval efficiency |
| **MRR (Mean Reciprocal Rank)** | Average of 1/rank for the first relevant result | When you care about whether the single best chunk surfaces first |
| **NDCG (Normalized Discounted Cumulative Gain)** | Weighted relevance score accounting for position | When relevance is graded (not binary) — correlates more strongly with end-to-end RAG quality than binary metrics |
| **Token-level IoU** | Overlap between retrieved tokens and ground-truth relevant tokens | More granular than document-level metrics; specifically designed for chunking evaluation. Proposed by Chroma's research group. |

**Key finding:** Chroma's research found up to **9% Recall@K difference** between chunking strategies — enough to meaningfully affect end-to-end quality.

### End-to-end RAG metrics

These measure the quality of the final generated answer. Critical because **retrieval metrics alone are misleading** — the Vecta 2026 benchmark showed semantic chunking scoring 91.9% recall but only 54% end-to-end accuracy (vs. 69% for recursive splitting) because fragments were too small for the LLM to synthesize answers.

| Metric | What it measures | Source |
|---|---|---|
| **Faithfulness** | Can all claims in the answer be traced to retrieved context? | RAGAS framework |
| **Answer Relevancy** | Does the response address the user's question? | RAGAS framework |
| **Context Precision** | Of retrieved chunks, what fraction is relevant? | RAGAS framework |
| **Context Recall** | Of information needed to answer, what fraction was in retrieved chunks? | RAGAS framework |
| **NV Answer Accuracy** | Agreement between response and reference answer, averaged across multiple LLM judges | NVIDIA |
| **AutoNuggetizer** | Decomposes reference answers into atomic facts ("nuggets") and checks coverage | TREC RAG track |

**The chunking connection:** Chunk size directly affects faithfulness — too-small chunks cause hallucination because the LLM lacks context. Too-large chunks dilute relevance signal. The 256-512 token range consistently performs best across studies.

### Chunk-level quality metrics

These evaluate chunks independent of any retrieval or generation task — useful for sanity-checking a chunking strategy without running full evaluations.

| Metric | What it measures | How to compute |
|---|---|---|
| **Cohesion score** | Topical focus of a chunk | Average pairwise cosine similarity of sentence embeddings within the chunk. Higher = more coherent. |
| **Size distribution** | Consistency of chunk sizes | Mean, median, std dev of chunk token counts. High variance (e.g., chunks ranging from 10 to 2000 tokens) is a red flag. |
| **Boundary accuracy** | Alignment with topic boundaries | How closely automated boundaries match human-annotated or structurally-defined topic breaks. Domain-specific — the clinical decision support study (MDPI Bioengineering 2025) found adaptive boundary alignment hit 87% vs. 13% for fixed-size. |

### Standard benchmarks and datasets

| Benchmark | What it tests | Notes |
|---|---|---|
| **BEIR** | 18 datasets across 9 retrieval task types | Standard for embedding model evaluation; by extension, chunking. Includes NQ, HotpotQA, FiQA, SciFact. |
| **TREC RAG Track** | 301 test topics with graded relevance | Most rigorous academic RAG evaluation. Uses UMBRELA automated judgments + human assessment. |
| **SQuAD** | Short-context factoid QA | Good for testing small-chunk retrieval. Peak recall at 64-256 tokens. |
| **NarrativeQA** | Long unstructured texts, analytical questions | Tests large-chunk strategies. Recall improves significantly at 512-1024 tokens. |
| **Vectara Open RAG Bench** | Multimodal PDFs (text, tables, charts) | End-to-end RAG pipeline evaluation. Publicly available on GitHub. |

### Practical evaluation workflow

The consensus from 2025-2026 production experience:

1. **Start with retrieval-only evaluation** to narrow chunking candidates. Hold the embedding model constant, vary chunking parameters, measure Recall@K. This is fast and cheap (no LLM generation calls).
2. **Run end-to-end evaluation** on the top 2-3 candidates. Use RAGAS or equivalent with a held-out question set and reference answers. Measure faithfulness and answer accuracy.
3. **Deploy with observability.** Trace individual RAG requests through the pipeline (Langfuse, Arize Phoenix, or custom logging). Monitor retrieval latency, chunk count, and user feedback.
4. **Iterate.** Re-evaluate when changing embedding models, chunk sizes, or content types.

### Sources

- [RAGAS Metrics Documentation](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- [Chroma Research: Evaluating Chunking Strategies](https://research.trychroma.com/evaluating-chunking)
- [Chroma chunking_evaluation (GitHub)](https://github.com/brandonstarxel/chunking_evaluation)
- [Vectara NAACL 2025 (arXiv:2410.13070)](https://arxiv.org/abs/2410.13070) — chunking config impact on retrieval, p = 1.59 × 10⁻⁵
- [Vecta 2026 Chunking Benchmark](https://www.runvecta.com/blog/we-benchmarked-7-chunking-strategies-most-advice-was-wrong)
- [NVIDIA: Finding the Best Chunking Strategy](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/)
- [Vectara Open RAG Eval (GitHub)](https://github.com/vectara/open-rag-eval)
- [TREC RAG Track](https://trec-rag.github.io/)
- [BEIR Benchmark (GitHub)](https://github.com/beir-cellar/beir)
- [Clinical Decision Support Chunking Study (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12649634/)
- [S2 Chunking Framework (arXiv:2501.05485)](https://arxiv.org/html/2501.05485v1)
- [Langfuse RAG Observability](https://langfuse.com/blog/2025-10-28-rag-observability-and-evals)
