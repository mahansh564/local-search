import { Database } from 'bun:sqlite';
import { VectorSearch } from './vector.js';

interface HybridResult {
  id: number;
  path: string;
  title: string;
  content: string;
  ftsScore: number;
  vectorDistance: number;
  combinedScore: number;
}

export class HybridSearch {
  private db: Database;
  private vectorSearch: VectorSearch;

  constructor(db: Database) {
    this.db = db;
    this.vectorSearch = new VectorSearch(db);
  }

  search(query: string, limit: number = 10): HybridResult[] {
    const ftsResults = this.getFTSResults(query, limit * 2);
    const vectorResults = this.vectorSearch.search(query, limit * 2);
    
    const combined = this.combineResults(ftsResults, vectorResults);
    
    return combined.slice(0, limit);
  }

  private getFTSResults(query: string, limit: number): Array<{ id: number; path: string; title: string; rank: number }> {
    return this.db.query(`
      SELECT d.id, d.path, d.title, rank
      FROM documents_fts fts
      JOIN documents d ON fts.rowid = d.id
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as any[];
  }

  private combineResults(
    ftsResults: Array<{ id: number; path: string; title: string; rank: number }>,
    vectorResults: Array<{ hash: string; path: string; title: string; distance: number }>
  ): HybridResult[] {
    const scores = new Map<number, { ftsScore: number; vectorScore: number; path: string; title: string }>();

    const ftsWeight = 0.4;
    const vectorWeight = 0.6;

    for (const result of ftsResults) {
      const normalizedScore = 1 / (1 + Math.abs(result.rank));
      scores.set(result.id, {
        ftsScore: normalizedScore * ftsWeight,
        vectorScore: 0,
        path: result.path,
        title: result.title,
      });
    }

    for (const result of vectorResults) {
      const normalizedScore = 1 / (1 + result.distance);
      const docId = parseInt(result.hash);

      if (scores.has(docId)) {
        const existing = scores.get(docId)!;
        existing.vectorScore = normalizedScore * vectorWeight;
      } else {
        scores.set(docId, {
          ftsScore: 0,
          vectorScore: normalizedScore * vectorWeight,
          path: result.path,
          title: result.title,
        });
      }
    }

    const results: HybridResult[] = [];
    for (const [id, scoreData] of scores.entries()) {
      results.push({
        id,
        path: scoreData.path,
        title: scoreData.title,
        content: '',
        ftsScore: scoreData.ftsScore,
        vectorDistance: scoreData.vectorScore > 0 ? (1 / scoreData.vectorScore - 1) * vectorWeight : Infinity,
        combinedScore: scoreData.ftsScore + scoreData.vectorScore,
      });
    }

    return results.sort((a, b) => b.combinedScore - a.combinedScore);
  }
}