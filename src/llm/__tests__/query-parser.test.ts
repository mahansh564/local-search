import { test, expect } from 'bun:test';
import {
  normalizeQueryParseResult,
  buildBm25Query,
  buildSourceFilter,
  mergeFilters,
  parseQueryWithLLM,
} from '../query-parser';

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

test('mergeFilters combines source filter with existing filter', () => {
  const sourceFilter = buildSourceFilter(['apple-notes']);
  const existing = {
    operator: 'and',
    filters: [{ field: 'tag', operator: 'contains', value: 'x' }],
  };
  const merged = mergeFilters(existing, sourceFilter);
  expect(merged?.filters?.length).toBe(2);
});

test('parseQueryWithLLM falls back to empty parse on error', async () => {
  const parsed = await parseQueryWithLLM('what did I decide', {
    model: 'dummy',
    llm: { invoke: async () => { throw new Error('fail'); } },
  });
  expect(parsed.keywords.length).toBe(0);
  expect(parsed.sources.length).toBe(0);
});
