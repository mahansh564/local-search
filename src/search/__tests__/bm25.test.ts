import { test, expect } from 'bun:test';
import { BM25Search } from '../bm25';

test('BM25 indexes and searches documents', () => {
  const bm25 = new BM25Search();

  const docs = [
    { id: '1', text: 'The quick brown fox jumps over the lazy dog' },
    { id: '2', text: 'A quick brown dog outpaces a swift fox' },
    { id: '3', text: 'Lazy cats sleep all day long' },
  ];

  bm25.indexDocuments(docs);

  const results = bm25.search('quick brown fox', 2);

  expect(results.length).toBeGreaterThan(0);
  expect(results[0]?.score).toBeGreaterThan(0);
});

test('BM25 ranks documents with matching terms higher', () => {
  const bm25 = new BM25Search();

  const docs = [
    { id: '1', text: 'machine learning tutorial' },
    { id: '2', text: 'machine learning and deep learning guide' },
    { id: '3', text: 'cooking recipes and food' },
  ];

  bm25.indexDocuments(docs);
  const results = bm25.search('machine learning', 10);

  const doc3Index = results.findIndex((r) => r.id === '3');
  expect(doc3Index).toBe(-1);

  const doc1Index = results.findIndex((r) => r.id === '1');
  const doc2Index = results.findIndex((r) => r.id === '2');
  expect(doc1Index).toBeGreaterThan(-1);
  expect(doc2Index).toBeGreaterThan(-1);
});

test('BM25 throws error when not indexed', () => {
  const bm25 = new BM25Search();

  expect(() => {
    bm25.search('query', 10);
  }).toThrow('BM25 not indexed');
});

test('BM25 ignores common stopwords in query', () => {
  const bm25 = new BM25Search();

  const docs = [
    { id: '1', text: 'decide realtime' },
    { id: '2', text: 'what did i about the' },
  ];

  bm25.indexDocuments(docs);

  const results = bm25.search('what did I decide about realtime', 1);

  expect(results[0]?.id).toBe('1');
});
