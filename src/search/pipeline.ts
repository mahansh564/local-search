import { Database } from 'bun:sqlite';
import { VectorSearch } from './vector-new.js';
import { BM25Search } from './bm25.js';
import { EmbeddingGenerator } from './embeddings-new.js';
import {
  ReciprocalRankFusion,
  CrossEncoderReranker,
  ScoreNormalizer,
  type RerankInput,
} from './reranking.js';
import { MetadataQueryBuilder, type FilterGroup } from './filters.js';

export interface RAGConfig {
  vectorWeight?: number;
  bm25Weight?: number;
  rrfK?: number;
  enableReranking?: boolean;
  enableMMR?: boolean;
  mmrLambda?: number;
  enableQueryExpansion?: boolean;
}

export interface RAGResult {
  id: string;
  documentId: number;
  path: string;
  title: string;
  content: string;
  fullContent?: string;
  matchedChunk?: string;
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
  enableMMR?: boolean;
  includeFullDocument?: boolean;
  enableQueryExpansion?: boolean;
}

export class RAGPipeline {
  private db: Database;
  private vectorSearch: VectorSearch;
  private bm25: BM25Search;
  private rrf: ReciprocalRankFusion;
  private reranker: CrossEncoderReranker;
  private queryBuilder: MetadataQueryBuilder;
  private embedder: EmbeddingGenerator;
  private config: RAGConfig;

  constructor(db: Database, config: RAGConfig = {}) {
    this.db = db;
    this.config = {
      rrfK: 60,
      enableReranking: true,
      enableMMR: false,
      mmrLambda: 0.5,
      enableQueryExpansion: false,
      ...config,
    };

    this.vectorSearch = new VectorSearch(db);
    this.bm25 = new BM25Search();
    this.rrf = new ReciprocalRankFusion(this.config.rrfK);
    this.reranker = new CrossEncoderReranker();
    this.embedder = new EmbeddingGenerator();
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
    const enableMMR = options.enableMMR ?? this.config.enableMMR ?? false;
    const mmrLambda = this.config.mmrLambda ?? 0.5;
    const includeFullDocument = options.includeFullDocument ?? false;
    const enableQueryExpansion = options.enableQueryExpansion ?? this.config.enableQueryExpansion ?? false;
    const fetchMultiplier = enableMMR ? 5 : 3;

    let searchQuery = query;
    let queryVariations: string[] = [query];

    if (enableQueryExpansion) {
      await this.embedder.initialize();
      const expanded = await this.embedder.generateExpandedEmbeddings(query);
      queryVariations = expanded.queryVariations;
    }

    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearch.search(searchQuery, limit * fetchMultiplier, { useMMR: enableMMR, mmrLambda }),
      Promise.resolve(this.bm25.search(query, limit * fetchMultiplier)),
    ]);

    let filteredVectorResults = vectorResults;
    if (options.filter) {
      filteredVectorResults = await this.filterVectorResults(vectorResults, options.filter);
    }

    const deduplicatedVectorResults = this.deduplicateByDocumentId(filteredVectorResults);

    const vectorRanked = ScoreNormalizer.rankNormalize(
      deduplicatedVectorResults.map((r, i) => ({
        id: r.documentId.toString(),
        score: r.distance,
        rank: i,
        metadata: r,
      }))
    );

    const bm25Ranked = ScoreNormalizer.rankNormalize(
      bm25Results.map((r, i) => ({
        id: r.id,
        score: r.score,
        rank: i,
      }))
    );

    const fused = this.rrf.fuse([
      { source: 'vector', results: vectorRanked },
      { source: 'bm25', results: bm25Ranked },
    ]);

    const results = await this.fetchDocuments(fused.slice(0, limit * fetchMultiplier), {
      includeFullDocument,
      vectorResults: deduplicatedVectorResults,
    });
    const deduplicatedResults = this.deduplicateByPath(results).slice(0, limit);

    if (enableReranking && deduplicatedResults.length > 0) {
      return await this.rerankResults(query, deduplicatedResults);
    }

    return deduplicatedResults;
  }

  private deduplicateByDocumentId(
    results: Awaited<ReturnType<VectorSearch['search']>>
  ): typeof results {
    const bestByDocument = new Map<number, typeof results[0]>();
    
    for (const result of results) {
      const existing = bestByDocument.get(result.documentId);
      if (!existing || result.distance < existing.distance) {
        bestByDocument.set(result.documentId, result);
      }
    }
    
    return Array.from(bestByDocument.values());
  }

  private deduplicateByPath(results: RAGResult[]): RAGResult[] {
    const bestByPath = new Map<string, RAGResult>();
    
    for (const result of results) {
      const existing = bestByPath.get(result.path);
      if (!existing || result.score > existing.score) {
        bestByPath.set(result.path, result);
      }
    }
    
    return Array.from(bestByPath.values());
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
    fused: Awaited<ReturnType<ReciprocalRankFusion['fuse']>>,
    options: {
      includeFullDocument?: boolean;
      vectorResults?: Array<{
        documentId: number;
        content: string;
        chunkIndex: number;
      }>;
    } = {}
  ): Promise<RAGResult[]> {
    const { includeFullDocument = false, vectorResults = [] } = options;
    const vectorResultsMap = new Map<number, typeof vectorResults[0]>();
    for (const vr of vectorResults) {
      const existing = vectorResultsMap.get(vr.documentId);
      if (!existing || vr.chunkIndex < existing.chunkIndex) {
        vectorResultsMap.set(vr.documentId, vr);
      }
    }

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
      const matchedChunk = vectorResultsMap.get(docId)?.content;

      results.push({
        id: item.id,
        documentId: doc.id,
        path: doc.path,
        title: doc.title,
        content: includeFullDocument ? doc.content : doc.content.substring(0, 500),
        fullContent: includeFullDocument ? doc.content : undefined,
        matchedChunk: matchedChunk ? matchedChunk.substring(0, 500) : undefined,
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
