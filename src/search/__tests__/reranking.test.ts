import { test, expect } from 'bun:test';
import { ReciprocalRankFusion } from '../reranking';

test('RRF combines results from multiple sources', () => {
  const rrf = new ReciprocalRankFusion(60);

  const vectorResults = [
    { id: 'doc1', score: 0.9 },
    { id: 'doc2', score: 0.8 },
    { id: 'doc3', score: 0.7 },
  ];

  const bm25Results = [
    { id: 'doc2', score: 2.5 },
    { id: 'doc1', score: 2.0 },
    { id: 'doc4', score: 1.5 },
  ];

  const fused = rrf.fuse([
    { source: 'vector', results: vectorResults },
    { source: 'bm25', results: bm25Results },
  ]);

  expect(fused.length).toBe(4);
  expect(fused[0]?.id).toBeOneOf(['doc1', 'doc2']);
  expect(fused[0]?.score).toBeGreaterThan(fused[3]?.score || 0);
});

test('RRF with k=60 produces expected scores', () => {
  const rrf = new ReciprocalRankFusion(60);

  const results = [
    {
      source: 'test',
      results: [{ id: 'doc1', score: 1.0 }],
    },
  ];

  const fused = rrf.fuse(results);

  expect(fused[0]?.score).toBeCloseTo(1 / 61, 5);
});

test('RRF documents appearing in both sources rank higher', () => {
  const rrf = new ReciprocalRankFusion(60);

  const source1 = [
    { id: 'doc1', score: 0.5 },
    { id: 'doc2', score: 0.4 },
  ];

  const source2 = [
    { id: 'doc1', score: 0.3 },
    { id: 'doc3', score: 0.2 },
  ];

  const fused = rrf.fuse([
    { source: 's1', results: source1 },
    { source: 's2', results: source2 },
  ]);

  const doc1Result = fused.find((r) => r.id === 'doc1');
  const doc2Result = fused.find((r) => r.id === 'doc2');

  expect(doc1Result!.score).toBeGreaterThan(doc2Result!.score);
  expect(doc1Result!.sources.length).toBe(2);
});
