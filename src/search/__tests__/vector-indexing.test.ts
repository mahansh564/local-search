import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { VectorSearch } from '../vector-new';

test('VectorSearch stores chunk metadata', async () => {
  const db = new Database(':memory:');

  const fakeEmbedder = {
    initialize: async () => {},
    generateChunkEmbeddings: async () => [
      {
        chunk: {
          text: 'hello world',
          tokens: 2,
          index: 0,
          startOffset: 0,
          endOffset: 11,
          sectionTitle: 'Title',
        },
        embedding: new Array(384).fill(0),
      },
    ],
  };

  const vector = new VectorSearch(db, { embedder: fakeEmbedder });

  await vector.indexDocument(1, 'ignored');

  const row = db
    .query(
      'SELECT content, start_offset, end_offset, section_title FROM document_chunks WHERE document_id = 1'
    )
    .get() as {
    content: string;
    start_offset: number;
    end_offset: number;
    section_title: string;
  };

  expect(row.content).toBe('hello world');
  expect(row.start_offset).toBe(0);
  expect(row.end_offset).toBe(11);
  expect(row.section_title).toBe('Title');
});
