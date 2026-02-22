import { test, expect } from 'bun:test';
import { distanceToScore, buildRerankDocument } from '../pipeline';

test('distanceToScore treats smaller distance as higher score', () => {
  const near = distanceToScore(0.1);
  const far = distanceToScore(0.9);

  expect(near).toBeGreaterThan(far);
  expect(distanceToScore(0)).toBeGreaterThanOrEqual(near);
});

test('buildRerankDocument prefers matched chunk over truncated content', () => {
  const doc = buildRerankDocument({
    title: 'TODO',
    content: 'short preview',
    fullContent: 'full content that should not be used when matched chunk exists',
    matchedChunk: 'matched chunk about realtime',
  });

  expect(doc).toContain('TODO');
  expect(doc).toContain('matched chunk about realtime');
  expect(doc).not.toContain('short preview');
});
