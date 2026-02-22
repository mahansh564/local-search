import { test, expect } from 'bun:test';
import { encodingForModel } from 'js-tiktoken';
import { EmbeddingGenerator } from '../embeddings-new';

test('splits oversized sections into token windows without recursion', () => {
  const generator = new EmbeddingGenerator({ maxTokens: 20, overlap: 5 });
  const hugeSection = '# Title\n\n' + 'realtime decision '.repeat(200);

  const chunks = generator.semanticChunkText(hugeSection);

  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.map((c) => c.index)).toEqual([...Array(chunks.length).keys()]);

  const encoder = encodingForModel('text-embedding-ada-002');
  for (const chunk of chunks) {
    const tokenCount = encoder.encode(chunk.text).length;
    expect(tokenCount).toBeLessThanOrEqual(20);
  }
});
