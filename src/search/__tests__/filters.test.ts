import { test, expect } from 'bun:test';
import { MetadataQueryBuilder } from '../filters';

test('buildWhereClauseForDocIds offsets parameter indexes', () => {
  const builder = new MetadataQueryBuilder();

  const result = builder.buildWhereClauseForDocIds(
    { field: 'source', operator: 'eq', value: 'apple-notes' },
    3
  );

  expect(result.clause).toContain('?4');
  expect(result.params).toEqual(['apple-notes']);
  expect(result.paramCount).toBe(4);
});

test('buildWhereClauseForDocIds offsets group parameters', () => {
  const builder = new MetadataQueryBuilder();

  const result = builder.buildWhereClauseForDocIds(
    {
      operator: 'and',
      filters: [
        { field: 'source', operator: 'eq', value: 'apple-notes' },
        { field: 'source', operator: 'eq', value: 'email' },
      ],
    },
    2
  );

  expect(result.clause).toContain('?3');
  expect(result.clause).toContain('?4');
  expect(result.params).toEqual(['apple-notes', 'email']);
  expect(result.paramCount).toBe(4);
});
