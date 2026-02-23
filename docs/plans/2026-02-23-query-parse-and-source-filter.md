# Query Parsing + Source Filtering (Stage 1 LangChain) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a cheap LLM query parser (LangChain + Ollama) to extract keywords + sources, use it for BM25 + metadata filtering, and tag indexed documents with `source`.

**Architecture:** Introduce a query-parsing module that returns `{keywords, sources, confidence}`. BM25 uses keywords when confident; vector uses original query. Metadata source is indexed and filters are applied via existing JSON metadata filters.

**Tech Stack:** Bun, TypeScript, SQLite, LangChain JS (`@langchain/ollama`, `@langchain/core`), Ollama local.

---

### Task 1: Add query parser helper tests

**Files:**
- Create: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts`

**Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { normalizeQueryParseResult, buildBm25Query, buildSourceFilter } from '../query-parser';

test('normalizeQueryParseResult drops invalid sources and clamps confidence', () => {
  const normalized = normalizeQueryParseResult({
    keywords: ['realtime'],
    sources: ['apple-notes', 'invalid'],
    confidence: { keywords: 2, sources: -1 },
  });

  expect(normalized.sources).toEqual(['apple-notes']);
  expect(normalized.confidence.keywords).toBe(1);
  expect(normalized.confidence.sources).toBe(0);
});

test('buildBm25Query uses keywords when confident', () => {
  const parsed = {
    keywords: ['realtime', 'decide'],
    sources: [],
    confidence: { keywords: 0.8, sources: 0 },
  };
  expect(buildBm25Query('what did I decide', parsed)).toBe('realtime decide');
});

test('buildSourceFilter builds metadata filter for sources', () => {
  const filter = buildSourceFilter(['apple-notes', 'email']);
  expect(filter?.filters?.length).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
```

Expected: FAIL (`normalizeQueryParseResult` and helpers missing).

**Step 3: Write minimal implementation**

Create `/Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/query-parser.ts` with:

- `normalizeQueryParseResult`
- `buildBm25Query(original, parsed)`
- `buildSourceFilter(sources)`
- `mergeFilters(a, b)` (AND)

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/query-parser.ts
git commit -m "test: add query parser helpers"
```

---

### Task 2: Add LangChain-based query parsing (Stage 1)

**Files:**
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/package.json`
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/query-parser.ts`

**Step 1: Write the failing test**

Add to `/Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts`:

```ts
test('parseQueryWithLLM falls back to empty parse on error', async () => {
  const parsed = await parseQueryWithLLM('what did I decide', {
    model: 'dummy',
    llm: { invoke: async () => { throw new Error('fail'); } },
  });
  expect(parsed.keywords.length).toBe(0);
  expect(parsed.sources.length).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
```

Expected: FAIL (parseQueryWithLLM missing / doesn’t handle error).

**Step 3: Write minimal implementation**

- Add dependencies:
  - `@langchain/ollama`
  - `@langchain/core`
  - `zod`

- Implement `parseQueryWithLLM(query, {model?, llm?})`:
  - Use `ChatOllama` with `format: "json"` or `withStructuredOutput(zodSchema)`.
  - Prompt: return JSON `{keywords: string[], sources: string[], confidence: {keywords: number, sources: number}}`.
  - If error or invalid JSON, return empty parse.

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/search-cli/package.json \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/query-parser.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
git commit -m "feat: add langchain query parser (stage 1)"
```

---

### Task 3: Add source metadata + metadata builder

**Files:**
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/content-utils.ts`
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/base.ts`
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/storage/db.ts`
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/storage/__tests__/db-upsert.test.ts`

**Step 1: Write the failing test**

Extend `/Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/__tests__/content-utils.test.ts`:

```ts
test('buildDocumentMetadata includes source', () => {
  const metadata = buildDocumentMetadata('apple-notes', '# Title\n\nLink https://a.b');
  expect(metadata.source).toBe('apple-notes');
  expect(metadata.headings).toEqual(['Title']);
  expect(metadata.links).toEqual(['https://a.b']);
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/__tests__/content-utils.test.ts
```

Expected: FAIL (buildDocumentMetadata missing).

**Step 3: Write minimal implementation**

- Add `buildDocumentMetadata(source, content)` in `content-utils.ts`.
- Update `base.ts` to use it and pass `metadata` into `insertDocument`.
- Update `insertDocument` to update `metadata` even if hash unchanged, but only re-embed when content changes.

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/__tests__/content-utils.test.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/storage/__tests__/db-upsert.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/content-utils.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/base.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/storage/db.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/__tests__/content-utils.test.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/storage/__tests__/db-upsert.test.ts
git commit -m "feat: add source metadata and incremental updates"
```

---

### Task 4: Apply query parsing + source filters in pipeline

**Files:**
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/search/pipeline.ts`
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/cli/commands/query.ts`
- Modify: `/Users/anshulmahajan/Desktop/Projects/search-cli/src/cli/commands/ask.ts`

**Step 1: Write the failing test**

Add to `/Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts`:

```ts
test('mergeFilters combines source filter with existing filter', () => {
  const sourceFilter = buildSourceFilter(['apple-notes']);
  const existing = { operator: 'and', filters: [{ field: 'tag', operator: 'contains', value: 'x' }] };
  const merged = mergeFilters(existing, sourceFilter);
  expect(merged?.filters?.length).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
```

Expected: FAIL (mergeFilters or buildSourceFilter missing).

**Step 3: Write minimal implementation**

- In `pipeline.ts`, call `parseQueryWithLLM` when enabled.
- BM25 query = `buildBm25Query(original, parsed)` (fallback to original).
- Build source filter from parsed sources and merge with existing filter.
- Enable in `queryCommand` and `askCommand` by default.

**Step 4: Run test to verify it passes**

Run:
```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/anshulmahajan/Desktop/Projects/search-cli/src/search/pipeline.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/cli/commands/query.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/cli/commands/ask.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/query-parser.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts
git commit -m "feat: apply query parsing + source filtering"
```

---

### Task 5: Verification

**Step 1: Run targeted tests**

```bash
bun test /Users/anshulmahajan/Desktop/Projects/search-cli/src/llm/__tests__/query-parser.test.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/indexers/__tests__/content-utils.test.ts \
  /Users/anshulmahajan/Desktop/Projects/search-cli/src/storage/__tests__/db-upsert.test.ts
```

Expected: PASS.

**Step 2: Manual smoke check**

```bash
bun run /Users/anshulmahajan/Desktop/Projects/search-cli/src/index.ts query "what do I say about realtime in apple notes" --limit 10 --full --debug
```

Expected: results only from Apple Notes paths.

**Step 3: Commit verification**

No new code changes expected.

---

**Plan complete.** Saved to:
`/Users/anshulmahajan/Desktop/Projects/search-cli/docs/plans/2026-02-23-query-parse-and-source-filter.md`

Two execution options:

1. **Subagent-Driven (this session)** — I dispatch a fresh subagent per task and review between tasks.
2. **Parallel Session (separate)** — Open a new session and run `superpowers:executing-plans` with checkpoints.

Which approach do you want?
