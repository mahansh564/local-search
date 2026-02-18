import { Database } from 'bun:sqlite';
import * as sqliteVec from 'sqlite-vec';
import { EmbeddingGenerator } from './embeddings-new.js';

export interface VectorSearchResult {
  chunkId: string;
  documentId: number;
  path: string;
  title: string;
  content: string;
  distance: number;
  chunkIndex: number;
}

export interface ChunkRecord {
  id: number;
  document_id: number;
  chunk_index: number;
  content: string;
  embedding: Float32Array;
}

export class VectorSearch {
  private db: Database;
  private embedder: EmbeddingGenerator;
  private tableName = 'document_chunks_vec';

  constructor(db: Database) {
    this.db = db;
    this.embedder = new EmbeddingGenerator();
    this.initialize();
  }

  private initialize(): void {
    sqliteVec.load(this.db);

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        embedding float[384]
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_chunks_document 
      ON document_chunks(document_id)
    `);
  }

  async indexDocument(documentId: number, content: string): Promise<void> {
    await this.embedder.initialize();

    const existingChunks = this.db
      .query(`SELECT id FROM document_chunks WHERE document_id = ?`)
      .all(documentId) as Array<{ id: number }>;

    for (const chunk of existingChunks) {
      this.db.run(`DELETE FROM ${this.tableName} WHERE rowid = ?`, [chunk.id]);
    }

    this.db.run(`DELETE FROM document_chunks WHERE document_id = ?`, [documentId]);

    const chunkEmbeddings = await this.embedder.generateChunkEmbeddings(content);

    for (const { chunk, embedding } of chunkEmbeddings) {
      const result = this.db.run(
        `INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, ?, ?)`,
        [documentId, chunk.index, chunk.text]
      );

      const chunkId = result.lastInsertRowid;
      const embeddingArray = new Float32Array(embedding);
      this.db.run(
        `INSERT INTO ${this.tableName} (rowid, embedding) VALUES (?, ?)`,
        [chunkId, embeddingArray]
      );
    }
  }

  async search(query: string, limit: number = 10): Promise<VectorSearchResult[]> {
    await this.embedder.initialize();

    const queryEmbedding = await this.embedder.generateEmbedding(query);
    const queryVector = new Float32Array(queryEmbedding);

    const results = this.db
      .query(`
        SELECT 
          v.rowid as chunk_id,
          c.document_id,
          c.chunk_index,
          c.content,
          d.path,
          d.title,
          distance
        FROM ${this.tableName} v
        JOIN document_chunks c ON v.rowid = c.id
        JOIN documents d ON c.document_id = d.id
        WHERE embedding MATCH vec_f32(?)
        ORDER BY distance
        LIMIT ${limit}
      `)
      .all(JSON.stringify(Array.from(queryVector))) as Array<{
        chunk_id: number;
        document_id: number;
        chunk_index: number;
        content: string;
        path: string;
        title: string;
        distance: number;
      }>;

    return results.map((r) => ({
      chunkId: r.chunk_id.toString(),
      documentId: r.document_id,
      path: r.path,
      title: r.title,
      content: r.content,
      distance: r.distance,
      chunkIndex: r.chunk_index,
    }));
  }

  isAvailable(): boolean {
    try {
      this.db.run(`SELECT 1 FROM ${this.tableName} LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
