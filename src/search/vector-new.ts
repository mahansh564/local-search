import '../lib/sqlite-setup.js';
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
  startOffset?: number;
  endOffset?: number;
  sectionTitle?: string;
}

export interface ChunkRecord {
  id: number;
  document_id: number;
  chunk_index: number;
  content: string;
  embedding: Float32Array;
  start_offset?: number;
  end_offset?: number;
  section_title?: string;
}

/**
 * Maximal Marginal Relevance (MMR) algorithm for retrieval.
 * Balances relevance to query with diversity among selected results.
 * 
 * @param queryEmbedding - The embedding vector of the search query
 * @param candidates - Array of candidate embeddings with their metadata
 * @param k - Number of results to return
 * @param lambda - Balance parameter (0 = max diversity, 1 = max relevance). Default 0.5
 */
function mmr(
  queryEmbedding: number[],
  candidates: Array<{ embedding: number[]; [key: string]: any }>,
  k: number,
  lambda: number = 0.5
): Array<{ [key: string]: any }> {
  if (candidates.length <= k) return candidates;
  
  const selected: Array<{ [key: string]: any }> = [];
  const remaining = [...candidates];
  
  const querySimilarities = remaining.map(cand => ({
    cand,
    similarity: cosineSimilarity(queryEmbedding, cand.embedding)
  }));
  
  querySimilarities.sort((a, b) => b.similarity - a.similarity);
  const first = querySimilarities[0];
  if (!first) return candidates.slice(0, k);
  
  selected.push(first.cand);
  remaining.splice(remaining.indexOf(first.cand), 1);
  
  while (selected.length < k && remaining.length > 0) {
    let bestScore = -Infinity;
    let bestCandidate: typeof candidates[0] | null = null;
    let bestIndex = -1;
    
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      if (!cand) continue;
      
      const querySim = cosineSimilarity(queryEmbedding, cand.embedding);
      
      let maxSimilarityToSelected = 0;
      for (const sel of selected) {
        const sim = cosineSimilarity(cand.embedding, sel.embedding);
        maxSimilarityToSelected = Math.max(maxSimilarityToSelected, sim);
      }
      
      const mmrScore = lambda * querySim - (1 - lambda) * maxSimilarityToSelected;
      
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestCandidate = cand;
        bestIndex = i;
      }
    }
    
    if (bestCandidate) {
      selected.push(bestCandidate);
      remaining.splice(bestIndex, 1);
    }
  }
  
  return selected;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dotProduct += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export class VectorSearch {
  private db: Database;
  private embedder: {
    initialize: () => Promise<void>;
    generateChunkEmbeddings: (
      text: string
    ) => Promise<Array<{ chunk: { text: string; index: number; startOffset?: number; endOffset?: number; sectionTitle?: string }; embedding: number[] }>>;
  };
  private tableName = 'document_chunks_vec';

  constructor(
    db: Database,
    options: { embedder?: EmbeddingGenerator } = {}
  ) {
    this.db = db;
    this.embedder = options.embedder || new EmbeddingGenerator();
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
        start_offset INTEGER,
        end_offset INTEGER,
        section_title TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id)
      )
    `);

    try {
      this.db.run(`ALTER TABLE document_chunks ADD COLUMN start_offset INTEGER`);
    } catch {}
    try {
      this.db.run(`ALTER TABLE document_chunks ADD COLUMN end_offset INTEGER`);
    } catch {}
    try {
      this.db.run(`ALTER TABLE document_chunks ADD COLUMN section_title TEXT`);
    } catch {}

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
        `INSERT INTO document_chunks (document_id, chunk_index, content, start_offset, end_offset, section_title) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          documentId,
          chunk.index,
          chunk.text,
          chunk.startOffset ?? null,
          chunk.endOffset ?? null,
          chunk.sectionTitle ?? null,
        ]
      );

      const chunkId = result.lastInsertRowid;
      const embeddingArray = new Float32Array(embedding);
      this.db.run(
        `INSERT INTO ${this.tableName} (rowid, embedding) VALUES (?, ?)`,
        [chunkId, embeddingArray]
      );
    }
  }

  async search(
    query: string,
    limit: number = 10,
    options: { useMMR?: boolean; mmrLambda?: number } = {}
  ): Promise<VectorSearchResult[]> {
    const { useMMR = false, mmrLambda = 0.5 } = options;
    await this.embedder.initialize();

    const queryEmbedding = await this.embedder.generateEmbedding(query);
    const queryVector = new Float32Array(queryEmbedding);

    const fetchLimit = useMMR ? limit * 5 : limit;

    const results = this.db
      .query(`
        SELECT 
          v.rowid as chunk_id,
          c.document_id,
          c.chunk_index,
          c.content,
          c.start_offset,
          c.end_offset,
          c.section_title,
          d.path,
          d.title,
          distance
        FROM ${this.tableName} v
        JOIN document_chunks c ON v.rowid = c.id
        JOIN documents d ON c.document_id = d.id
        WHERE embedding MATCH vec_f32(?) AND k = ${fetchLimit}
        ORDER BY distance
      `)
      .all(JSON.stringify(Array.from(queryVector))) as Array<{
        chunk_id: number;
        document_id: number;
        chunk_index: number;
        content: string;
        start_offset: number | null;
        end_offset: number | null;
        section_title: string | null;
        path: string;
        title: string;
        distance: number;
      }>;

    if (useMMR && results.length > 0) {
      const candidates = await Promise.all(
        results.slice(0, fetchLimit).map(async (r) => ({
          ...r,
          embedding: await this.embedder.generateEmbedding(r.content),
        }))
      );

      const mmrResults = mmr(
        queryEmbedding,
        candidates.map((c) => ({
          embedding: c.embedding,
          chunkId: c.chunk_id.toString(),
          documentId: c.document_id,
          path: c.path,
          title: c.title,
          content: c.content,
          distance: c.distance,
          chunkIndex: c.chunk_index,
          startOffset: c.start_offset ?? undefined,
          endOffset: c.end_offset ?? undefined,
          sectionTitle: c.section_title ?? undefined,
        })),
        limit,
        mmrLambda
      );

      return mmrResults.map((r) => ({
        chunkId: r.chunkId as string,
        documentId: r.documentId as number,
        path: r.path as string,
        title: r.title as string,
        content: r.content as string,
        distance: r.distance as number,
        chunkIndex: r.chunkIndex as number,
        startOffset: r.startOffset as number | undefined,
        endOffset: r.endOffset as number | undefined,
        sectionTitle: r.sectionTitle as string | undefined,
      }));
    }

    return results.map((r) => ({
      chunkId: r.chunk_id.toString(),
      documentId: r.document_id,
      path: r.path,
      title: r.title,
      content: r.content,
      distance: r.distance,
      chunkIndex: r.chunk_index,
      startOffset: r.start_offset ?? undefined,
      endOffset: r.end_offset ?? undefined,
      sectionTitle: r.section_title ?? undefined,
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
