import { Database } from 'bun:sqlite';
import { VectorSearch } from './vector-new.js';
import { BM25Search } from './bm25.js';
import {
  ReciprocalRankFusion,
  CrossEncoderReranker,
  type RerankInput,
} from './reranking.js';
import { MetadataQueryBuilder, type FilterGroup } from './filters.js';

export interface RAGConfig {
  vectorWeight?: number;
  bm25Weight?: number;
  rrfK?: number;
  rerankTopK?: number;
  enableReranking?: boolean;
}

export interface RAGResult {
  id: string;
  documentId: number;
  path: string;
  title: string;
  content: string;
  score: number;
  vectorScore?: number;
  bm25Score?: number;
  rerankScore?: number;
  sources: Array<{ source: string; rank: number; score?: number }>;
  metadata?: Record<string, any>;
}

export interface RAGQueryOptions {
  limit?: number;
  filter?: FilterGroup;
  enableReranking?: boolean;
  rerankTopK?: number;
}

export class RAGPipeline {
  private db: Database;
  private vectorSearch: VectorSearch;
  private bm25: BM25Search;
  private rrf: ReciprocalRankFusion;
  private reranker: CrossEncoderReranker;
  private queryBuilder: MetadataQueryBuilder;
  private config: RAGConfig;

  constructor(db: Database, config: RAGConfig = {}) {
    this.db = db;
    this.config = {
      rrfK: 60,
      rerankTopK: 10,
      enableReranking: true,
      ...config,
    };

    this.vectorSearch = new VectorSearch(db);
    this.bm25 = new BM25Search();
    this.rrf = new ReciprocalRankFusion(this.config.rrfK);
    this.reranker = new CrossEncoderReranker();
    this.queryBuilder = new MetadataQueryBuilder();
  }

  async initialize(): Promise<void> {
    await this.reranker.initialize();
    this.indexBM25();
  }

  private indexBM25(): void {
    const docs = this.db
      .query(`
        SELECT d.id, d.path, d.title, c.doc as content
        FROM documents d
        JOIN content c ON d.hash = c.hash
      `)
      .all() as Array<{ id: number; path: string; title: string; content: string }>;

    const bm25Docs = docs.map((d) => ({
      id: d.id.toString(),
      text: `${d.title} ${d.content}`,
    }));

    this.bm25.indexDocuments(bm25Docs);
  }

  async search(query: string, options: RAGQueryOptions = {}): Promise<RAGResult[]> {
    const limit = options.limit || 10;
    const enableReranking = options.enableReranking ?? this.config.enableReranking;
    const rerankTopK = options.rerankTopK || this.config.rerankTopK || limit * 2;

    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearch.search(query, limit * 2),
      Promise.resolve(this.bm25.search(query, limit * 2)),
    ]);

    let filteredVectorResults = vectorResults;
    if (options.filter) {
      filteredVectorResults = await this.filterVectorResults(vectorResults, options.filter);
    }

    const vectorRanked = filteredVectorResults.map((r, i) => ({
      id: r.documentId.toString(),
      score: r.distance,
      rank: i,
      metadata: r,
    }));

    const bm25Ranked = bm25Results.map((r, i) => ({
      id: r.id,
      score: r.score,
      rank: i,
    }));

    const fused = this.rrf.fuse([
      { source: 'vector', results: vectorRanked },
      { source: 'bm25', results: bm25Ranked },
    ]);

    const results = await this.fetchDocuments(fused.slice(0, rerankTopK));

    if (enableReranking && results.length > 0) {
      return await this.rerankResults(query, results);
    }

    return results;
  }

  private async filterVectorResults(
    results: Awaited<ReturnType<VectorSearch['search']>>,
    filter: FilterGroup
  ): Promise<typeof results> {
    if (!filter.filters.length) return results;

    const docIds = results.map((r) => r.documentId);
    if (docIds.length === 0) return [];

    const { clause, params } = this.queryBuilder.buildWhereClause(filter);
    if (!clause) return results;

    const placeholders = docIds.map(() => '?').join(',');
    const query = `
      SELECT id FROM documents
      WHERE id IN (${placeholders}) AND ${clause}
    `;

    const filtered = this.db.query(query).all(...docIds, ...params) as Array<{ id: number }>;
    const allowedIds = new Set(filtered.map((r) => r.id));

    return results.filter((r) => allowedIds.has(r.documentId));
  }

  private async fetchDocuments(
    fused: Awaited<ReturnType<ReciprocalRankFusion['fuse']>>
  ): Promise<RAGResult[]> {
    const results: RAGResult[] = [];

    for (const item of fused) {
      const docId = parseInt(item.id);

      const doc = this.db
        .query(`
          SELECT d.id, d.path, d.title, d.metadata, c.doc as content
          FROM documents d
          JOIN content c ON d.hash = c.hash
          WHERE d.id = ?
        `)
        .get(docId) as {
          id: number;
          path: string;
          title: string;
          metadata: string;
          content: string;
        } | null;

      if (!doc) continue;

      const vectorSource = item.sources.find((s) => s.source === 'vector');
      const bm25Source = item.sources.find((s) => s.source === 'bm25');

      results.push({
        id: item.id,
        documentId: doc.id,
        path: doc.path,
        title: doc.title,
        content: doc.content.substring(0, 500),
        score: item.score,
        vectorScore: vectorSource?.originalScore,
        bm25Score: bm25Source?.originalScore,
        sources: item.sources,
        metadata: doc.metadata ? JSON.parse(doc.metadata) : undefined,
      });
    }

    return results;
  }

  private async rerankResults(query: string, results: RAGResult[]): Promise<RAGResult[]> {
    const rerankInputs: RerankInput[] = results.map((r) => ({
      id: r.id,
      query,
      document: `${r.title} ${r.content}`,
    }));

    const reranked = await this.reranker.rerank(query, rerankInputs, results.length);
    const rerankMap = new Map(reranked.map((r) => [r.id, r.score]));

    return results
      .map((r) => ({
        ...r,
        rerankScore: rerankMap.get(r.id),
        score: r.score * (rerankMap.get(r.id) || 0.5),
      }))
      .sort((a, b) => b.score - a.score);
  }
}
