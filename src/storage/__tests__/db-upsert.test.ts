import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseManager } from '../db';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

test('insertDocument upserts by path and updates FTS', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donut-db-'));
  const dbPath = path.join(tmpDir, 'index.sqlite');

  const dbManager = new DatabaseManager(dbPath);
  dbManager.init();

  const first = dbManager.insertDocument({
    path: 'apple-notes://1',
    title: 'TODO',
    content: 'first content',
    hash: sha256('first content'),
    metadata: { links: [], headings: [] },
  });

  const second = dbManager.insertDocument({
    path: 'apple-notes://1',
    title: 'TODO',
    content: 'second content with realtime',
    hash: sha256('second content with realtime'),
    metadata: { links: ['https://example.com'], headings: ['TODO'] },
  });

  expect(second.id).toBe(first.id);
  expect(first.updated).toBe(true);
  expect(second.updated).toBe(true);

  const db = new Database(dbPath);
  const countRow = db
    .query('SELECT COUNT(*) as count FROM documents WHERE path = ?')
    .get('apple-notes://1') as { count: number };
  expect(countRow.count).toBe(1);

  const ftsRow = db
    .query('SELECT body FROM documents_fts WHERE rowid = ?')
    .get(first.id) as { body: string };
  expect(ftsRow.body).toContain('realtime');

  const metadataRow = db
    .query('SELECT metadata FROM documents WHERE id = ?')
    .get(first.id) as { metadata: string };
  expect(JSON.parse(metadataRow.metadata).links).toEqual(['https://example.com']);

  db.close();
});

test('insertDocument skips update when hash unchanged', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donut-db-'));
  const dbPath = path.join(tmpDir, 'index.sqlite');

  const dbManager = new DatabaseManager(dbPath);
  dbManager.init();

  const hash = sha256('same content');
  const first = dbManager.insertDocument({
    path: 'apple-notes://2',
    title: 'TODO',
    content: 'same content',
    hash,
    metadata: { links: [], headings: [] },
  });

  const second = dbManager.insertDocument({
    path: 'apple-notes://2',
    title: 'TODO',
    content: 'same content',
    hash,
    metadata: { links: [], headings: [] },
  });

  expect(second.id).toBe(first.id);
  expect(second.updated).toBe(false);
});
