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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-cli-db-'));
  const dbPath = path.join(tmpDir, 'index.sqlite');

  const dbManager = new DatabaseManager(dbPath);
  dbManager.init();

  const firstId = dbManager.insertDocument({
    path: 'apple-notes://1',
    title: 'TODO',
    content: 'first content',
    hash: sha256('first content'),
  });

  const secondId = dbManager.insertDocument({
    path: 'apple-notes://1',
    title: 'TODO',
    content: 'second content with realtime',
    hash: sha256('second content with realtime'),
  });

  expect(secondId).toBe(firstId);

  const db = new Database(dbPath);
  const countRow = db
    .query('SELECT COUNT(*) as count FROM documents WHERE path = ?')
    .get('apple-notes://1') as { count: number };
  expect(countRow.count).toBe(1);

  const ftsRow = db
    .query('SELECT body FROM documents_fts WHERE rowid = ?')
    .get(firstId) as { body: string };
  expect(ftsRow.body).toContain('realtime');

  db.close();
});
