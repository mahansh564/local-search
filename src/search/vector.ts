import { Database } from 'bun:sqlite';
import { EmbeddingGenerator } from './embeddings.js';

interface VectorResult {
  hash: string;
  path: string;
  title: string;
  distance: number;
  content: string;
}

export class VectorSearch {
  private db: Database;
  private embedder: EmbeddingGenerator;

  constructor(db: Database) {
    this.db = db;
    this.embedder = new EmbeddingGenerator();
    this.initializeTable();
  }

  private initializeTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS vectors (
        document_id INTEGER PRIMARY KEY,
        embedding TEXT
      )
    `);
  }

  indexDocument(documentId: number, content: string): void {
    const chunks = this.embedder.chunkText(content);

    for (const chunk of chunks) {
      if (!chunk) continue;
      const embedding = this.embedder.generateEmbedding(chunk);
      const embeddingJson = JSON.stringify(embedding);

      this.db.run(
        'INSERT OR REPLACE INTO vectors (document_id, embedding) VALUES (?, ?)',
        [documentId, embeddingJson]
      );
    }
  }

  search(query: string, limit: number = 10): VectorResult[] {
    const queryEmbedding = this.embedder.generateEmbedding(query);

    const vectors = this.db.query(`
      SELECT v.document_id, v.embedding, d.path, d.title, c.doc as content
      FROM vectors v
      JOIN documents d ON v.document_id = d.id
      JOIN content c ON d.hash = c.hash
    `).all() as Array<{ document_id: number; embedding: string; path: string; title: string; content: string }>;

    const results: VectorResult[] = [];

    for (const row of vectors) {
      const docEmbedding = JSON.parse(row.embedding) as number[];
      const distance = this.cosineDistance(queryEmbedding, docEmbedding);

      results.push({
        hash: row.document_id.toString(),
        path: row.path,
        title: row.title,
        distance,
        content: row.content?.substring(0, 200) || '',
      });
    }

    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, limit);
  }

  private cosineDistance(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    const len = Math.min(a.length, b.length);

    for (let i = 0; i < len; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - similarity;
  }

  isAvailable(): boolean {
    try {
      this.db.run("SELECT 1 FROM vectors LIMIT 1");
      return true;
    } catch {
      return true;
    }
  }
}