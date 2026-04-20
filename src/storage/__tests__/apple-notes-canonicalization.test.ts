import { test, expect } from 'bun:test';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from 'bun:sqlite';
import { DatabaseManager } from '../db';

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

test('canonicalizeAppleNotesPaths removes numeric paths when coredata exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donut-db-'));
  const dbPath = path.join(tmpDir, 'index.sqlite');

  const dbManager = new DatabaseManager(dbPath);
  dbManager.init();

  const content = 'realtime decision';
  const hash = sha256(content);

  dbManager.insertDocument({
    path: 'apple-notes://1',
    title: 'TODO',
    content,
    hash,
    metadata: { links: [], headings: [] },
  });

  dbManager.insertDocument({
    path: 'apple-notes://x-coredata://foo/ICNote/p1',
    title: 'TODO',
    content,
    hash,
    metadata: { links: [], headings: [] },
  });

  const removed = dbManager.canonicalizeAppleNotesPaths();
  expect(removed).toBe(1);

  const db = new Database(dbPath);
  const numeric = db
    .query('SELECT COUNT(*) as count FROM documents WHERE path = ?')
    .get('apple-notes://1') as { count: number };

  expect(numeric.count).toBe(0);
  db.close();
});
