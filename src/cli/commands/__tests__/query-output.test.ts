import { test, expect } from 'bun:test';
import { formatResultOutput } from '../query';

test('formatResultOutput includes chunk offsets and section title', () => {
  const output = formatResultOutput(
    {
      title: 'TODO',
      path: 'apple-notes://1',
      score: 0.5,
      content: 'Hello world',
      matchedChunk: 'Hello world',
      chunkMetadata: {
        startOffset: 10,
        endOffset: 21,
        sectionTitle: 'Title',
      },
    },
    { full: false }
  );

  expect(output).toContain('Chunk: 10-21');
  expect(output).toContain('Section: Title');
});
