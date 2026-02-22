import { test, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppleNotesIndexer } from '../apple-notes';

test('falls back to AppleScript when Notes DB cannot be opened', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-db-'));
  const dbPath = path.join(tmpDir, 'NoteStore.sqlite');
  fs.writeFileSync(dbPath, '');

  const fakeNotes = [
    {
      id: 'note-1',
      title: 'TODO',
      content: 'realtime decision',
      created: new Date('2025-01-01'),
      modified: new Date('2025-01-02'),
    },
  ];

  const indexer = new AppleNotesIndexer(dbPath, {
    openDatabase: () => {
      throw new Error('authorization denied');
    },
    appleScriptFetcher: () => fakeNotes,
  });

  const notes = indexer.indexNotes();

  expect(notes).toEqual(fakeNotes);
});
