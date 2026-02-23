import '../lib/sqlite-setup.js';
import { Database } from 'bun:sqlite';
import fs from 'fs';

interface Document {
  id: number;
  path: string;
  title: string;
  score: number;
}

interface Stats {
  documentCount: number;
  collectionCount: number;
  dbSize: string;
  lastIndexed: string | null;
}

export class DatabaseManager {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
  }

  init(): void {
    this.createSchema();
  }

  private createSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE,
        path TEXT,
        type TEXT,
        config TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY,
        collection_id INTEGER,
        path TEXT,
        title TEXT,
        docid TEXT,
        hash TEXT,
        content_id INTEGER,
        metadata TEXT,
        indexed_at TEXT,
        FOREIGN KEY (collection_id) REFERENCES collections(id)
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS content (
        id INTEGER PRIMARY KEY,
        hash TEXT UNIQUE,
        doc TEXT NOT NULL,
        created_at TEXT
      );
    `);

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        path, title, body,
        tokenize='porter unicode61'
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS content_vectors (
        hash TEXT,
        seq INTEGER,
        embedding BLOB,
        PRIMARY KEY (hash, seq)
      );
    `);
  }

  search(query: string, limit: number, collection?: string): Document[] {
    let sql = `
      SELECT d.id, d.path, d.title, rank as score
      FROM documents_fts fts
      JOIN documents d ON fts.rowid = d.id
      WHERE documents_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (collection) {
      sql += ` AND d.collection_id = (SELECT id FROM collections WHERE name = ?)`;
      params.push(collection);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    return this.db.query(sql).all(...params) as Document[];
  }

  getStats(): Stats {
    const docCount = this.db.query('SELECT COUNT(*) as count FROM documents').get() as { count: number };
    const colCount = this.db.query('SELECT COUNT(*) as count FROM collections').get() as { count: number };
    const lastIndexed = this.db.query('SELECT MAX(indexed_at) as last FROM documents').get() as { last: string | null };

    const stats = fs.statSync(this.dbPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    return {
      documentCount: docCount?.count || 0,
      collectionCount: colCount?.count || 0,
      dbSize: `${sizeMB} MB`,
      lastIndexed: lastIndexed?.last || null,
    };
  }

  insertDocument(doc: {
    path: string;
    title: string;
    content: string;
    hash: string;
    metadata?: Record<string, any>;
  }): { id: number; updated: boolean } {
    const now = new Date().toISOString();

    this.db.run(
      'INSERT OR IGNORE INTO content (hash, doc, created_at) VALUES (?, ?, ?)',
      [doc.hash, doc.content, now]
    );

    const existing = this.db
      .query(
        'SELECT id, hash FROM documents WHERE path = ? ORDER BY indexed_at DESC, id DESC LIMIT 1'
      )
      .get(doc.path) as { id: number; hash: string } | null;

    if (existing?.id) {
      if (existing.hash === doc.hash) {
        if (doc.metadata) {
          this.db.run(
            'UPDATE documents SET title = ?, metadata = ?, indexed_at = ? WHERE id = ?',
            [doc.title, JSON.stringify(doc.metadata), now, existing.id]
          );
        }
        return { id: existing.id, updated: false };
      }

      this.db.run(
        'UPDATE documents SET title = ?, hash = ?, metadata = ?, indexed_at = ? WHERE id = ?',
        [
          doc.title,
          doc.hash,
          doc.metadata ? JSON.stringify(doc.metadata) : null,
          now,
          existing.id,
        ]
      );

      this.db.run('DELETE FROM documents_fts WHERE rowid = ?', [existing.id]);
      this.db.run(
        'INSERT INTO documents_fts (rowid, path, title, body) VALUES (?, ?, ?, ?)',
        [existing.id, doc.path, doc.title, doc.content]
      );

      return { id: existing.id, updated: true };
    }

    const result = this.db.run(
      'INSERT INTO documents (path, title, hash, metadata, indexed_at) VALUES (?, ?, ?, ?, ?)',
      [doc.path, doc.title, doc.hash, doc.metadata ? JSON.stringify(doc.metadata) : null, now]
    );

    const docId = result.lastInsertRowid;

    this.db.run(
      'INSERT INTO documents_fts (rowid, path, title, body) VALUES (?, ?, ?, ?)',
      [docId, doc.path, doc.title, doc.content]
    );

    return { id: Number(docId), updated: true };
  }

  dedupeDocumentsByPath(): number {
    const duplicates = this.db
      .query(`
        SELECT id FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (PARTITION BY path ORDER BY indexed_at DESC, id DESC) as rn
          FROM documents
        )
        WHERE rn > 1
      `)
      .all() as Array<{ id: number }>;

    if (duplicates.length === 0) return 0;

    const ids = duplicates.map((d) => d.id);
    const placeholders = ids.map(() => '?').join(',');

    this.db.run(`DELETE FROM documents WHERE id IN (${placeholders})`, ids);
    this.db.run(`DELETE FROM documents_fts WHERE rowid IN (${placeholders})`, ids);
    this.db.run(`DELETE FROM document_chunks WHERE document_id IN (${placeholders})`, ids);

    return ids.length;
  }

  canonicalizeAppleNotesPaths(): number {
    const toRemove = this.db
      .query(`
        SELECT d.id
        FROM documents d
        JOIN documents c
          ON c.hash = d.hash
          AND c.title = d.title
          AND c.path LIKE 'apple-notes://x-coredata://%'
        WHERE d.path GLOB 'apple-notes://[0-9]*'
      `)
      .all() as Array<{ id: number }>;

    if (toRemove.length === 0) return 0;

    const ids = toRemove.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');

    try {
      const chunkIds = this.db
        .query(
          `SELECT id FROM document_chunks WHERE document_id IN (${placeholders})`
        )
        .all(...ids) as Array<{ id: number }>;

      if (chunkIds.length > 0) {
        const chunkPlaceholders = chunkIds.map(() => '?').join(',');
        const chunkValues = chunkIds.map((row) => row.id);
        try {
          this.db.run(
            `DELETE FROM document_chunks_vec WHERE rowid IN (${chunkPlaceholders})`,
            chunkValues
          );
        } catch {}
      }
    } catch {}

    this.db.run(`DELETE FROM documents WHERE id IN (${placeholders})`, ids);
    this.db.run(`DELETE FROM documents_fts WHERE rowid IN (${placeholders})`, ids);
    try {
      this.db.run(`DELETE FROM document_chunks WHERE document_id IN (${placeholders})`, ids);
    } catch {}

    return ids.length;
  }
}
