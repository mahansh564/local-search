import { test, expect } from 'bun:test';
import { normalizeContent, extractMetadata, buildDocumentMetadata } from '../content-utils';

test('normalizeContent fixes mojibake and normalizes whitespace', () => {
  const input = 'I‚Äôve  always  been\n\n\n  here üíô';
  const normalized = normalizeContent(input);

  expect(normalized).toContain("I've");
  expect(normalized).not.toContain('‚Äô');
  expect(normalized).not.toContain('üíô');
  expect(normalized).toBe("I've always been\n\nhere 😀");
});

test('extractMetadata finds headings and links', () => {
  const input = '# Title\n\nSee https://example.com/path and http://foo.test';
  const metadata = extractMetadata(input);

  expect(metadata.headings).toEqual(['Title']);
  expect(metadata.links).toEqual(['https://example.com/path', 'http://foo.test']);
});

test('buildDocumentMetadata includes source', () => {
  const metadata = buildDocumentMetadata('apple-notes', '# Title\n\nLink https://a.b');
  expect(metadata.source).toBe('apple-notes');
  expect(metadata.headings).toEqual(['Title']);
  expect(metadata.links).toEqual(['https://a.b']);
});
