# SOTA RAG Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform basic RAG into state-of-the-art with real embeddings, BM25, proper hybrid search with RRF, metadata filtering, and reranking.

**Architecture:** Multi-stage retrieval pipeline: Query Analysis → Parallel BM25 + Vector (ANN) → RRF Fusion → Metadata Filtering → Cross-encoder Reranking → Context Assembly

**Tech Stack:** Xenova Transformers (local embeddings/reranking), sqlite-vec (vector DB), Bun SQLite

---

## Phase 1: Fix Critical Issues

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add Xenova Transformers dependency**

```bash
bun add @xenova/transformers
```

**Step 2: Verify package.json has all needed deps**

Should include:
- `@xenova/transformers` - for real embeddings and reranking
- `sqlite-vec` - already there
- `js-tiktoken` - already there

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "deps: add @xenova/transformers for real embeddings"
```

---

### Task 2: Create Real Embeddings Module

**Files:**
- Create: `src/search/embeddings-new.ts`
- Delete: `src/search/embeddings.ts` (old fake embeddings)

**Step 1: Create real embeddings module**

```typescript
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { encodingForModel } from 'js-tiktoken';

export interface EmbeddingConfig {
  model?: string;
  maxTokens?: number;
  overlap?: number;
}

export interface TextChunk {
  text: string;
  tokens: number;
  index: number;
}

export class EmbeddingGenerator {
  private embedder: FeatureExtractionPipeline | null = null;
  private encoder: ReturnType<typeof encodingForModel>;
  private modelName: string;
  private maxTokens: number;
  private overlap: number;

  constructor(config: EmbeddingConfig = {}) {
    this.modelName = config.model || 'Xenova/all-MiniLM-L6-v2';
    this.maxTokens = config.maxTokens || 512;
    this.overlap = config.overlap || 50;
    this.encoder = encodingForModel('text-embedding-ada-002');
  }

  async initialize(): Promise<void> {
    if (!this.embedder) {
      console.log(`Loading embedding model: ${this.modelName}...`);
      this.embedder = await pipeline('feature-extraction', this.modelName);
      console.log('Embedding model loaded');
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) {
      await this.initialize();
    }

    const output = await this.embedder!(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data);
  }

  chunkText(text: string): TextChunk[] {
    const tokens = this.encoder.encode(text);
    const chunks: TextChunk[] = [];

    let start = 0;
    let chunkIndex = 0;

    while (start < tokens.length) {
      const end = Math.min(start + this.maxTokens, tokens.length);
      const chunkTokens = tokens.slice(start, end);
      const chunkText = this.encoder.decode(chunkTokens);

      chunks.push({
        text: chunkText,
        tokens: chunkTokens.length,
        index: chunkIndex++,
      });

      if (end >= tokens.length) break;
      start = end - this.overlap;
    }

    return chunks;
  }

  async generateChunkEmbeddings(text: string): Promise<Array<{ chunk: TextChunk; embedding: number[] }>> {
    const chunks = this.chunkText(text);
    const results = [];

    for (const chunk of chunks) {
      const embedding = await this.generateEmbedding(chunk.text);
      results.push({ chunk, embedding });
    }

    return results;
  }

  getEmbeddingDimensions(): number {
    // all-MiniLM-L6-v2 produces 384-dimensional embeddings
    return 384;
  }
}
```

**Step 2: Delete old fake embeddings file**

```bash
rm src/search/embeddings.ts
```

**Step 3: Commit**

```bash
git add src/search/embeddings-new.ts
git rm src/search/embeddings.ts
git commit -m "feat: implement real semantic embeddings with Xenova Transformers"
```

---

### Task 3: Implement Proper BM25 Algorithm

**Files:**
- Create: `src/search/bm25.ts`

**Step 1: Create BM25 module**

```typescript
interface BM25Document {
  id: string;
  text: string;
}

interface BM25Stats {
  totalDocs: number;
  avgDocLength: number;
  docLengths: Map<string, number>;
  termFrequencies: Map<string, Map<string, number>>; // term -> docId -> freq
  docFrequencies: Map<string, number>; // term -> number of docs containing it
}

export class BM25Search {
  private k1: number;
  private b: number;
  private stats: BM25Stats | null = null;

  constructor(k1: number = 1.5, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  indexDocuments(docs: BM25Document[]): void {
    const totalDocs = docs.length;
    const docLengths = new Map<string, number>();
    const termFrequencies = new Map<string, Map<string, number>>();
    const docFrequencies = new Map<string, Set<string>>();

    let totalLength = 0;

    for (const doc of docs) {
      const tokens = this.tokenize(doc.text);
      const docLength = tokens.length;
      docLengths.set(doc.id, docLength);
      totalLength += docLength;

      // Count term frequencies for this document
      const termCounts = new Map<string, number>();
      for (const token of tokens) {
        termCounts.set(token, (termCounts.get(token) || 0) + 1);
      }

      // Update global term frequencies
      for (const [term, count] of termCounts) {
        if (!termFrequencies.has(term)) {
          termFrequencies.set(term, new Map());
        }
        termFrequencies.get(term)!.set(doc.id, count);

        if (!docFrequencies.has(term)) {
          docFrequencies.set(term, new Set());
        }
        docFrequencies.get(term)!.add(doc.id);
      }
    }

    // Convert doc frequencies from Sets to counts
    const dfMap = new Map<string, number>();
    for (const [term, docs] of docFrequencies) {
      dfMap.set(term, docs.size);
    }

    this.stats = {
      totalDocs,
      avgDocLength: totalLength / totalDocs,
      docLengths,
      termFrequencies,
      docFrequencies: dfMap,
    };
  }

  search(query: string, topK: number = 10): Array<{ id: string; score: number }> {
    if (!this.stats) {
      throw new Error('BM25 not indexed. Call indexDocuments() first.');
    }

    const queryTerms = this.tokenize(query);
    const scores = new Map<string, number>();

    for (const term of queryTerms) {
      const df = this.stats.docFrequencies.get(term) || 0;
      if (df === 0) continue;

      // IDF calculation
      const idf = Math.log(
        (this.stats.totalDocs - df + 0.5) / (df + 0.5) + 1
      );

      // Get term frequencies for this term across all docs
      const termDocFreqs = this.stats.termFrequencies.get(term);
      if (!termDocFreqs) continue;

      for (const [docId, tf] of termDocFreqs) {
        const docLength = this.stats.docLengths.get(docId) || 0;
        const normalizedLength = docLength / this.stats.avgDocLength;

        // BM25 score for this term
        const score =
          idf *
          ((tf * (this.k1 + 1)) /
            (tf + this.k1 * (1 - this.b + this.b * normalizedLength)));

        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }
}
```

**Step 2: Commit**

```bash
git add src/search/bm25.ts
git commit -m "feat: implement proper BM25 algorithm"
```

---

### Task 4: Refactor Vector Search to Use sqlite-vec

**Files:**
- Create: `src/search/vector-new.ts`
- Delete: `src/search/vector.ts`

**Step 1: Create new vector search using sqlite-vec**

```typescript
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
    // Enable sqlite-vec extension
    sqliteVec.load(this.db);

    // Create virtual table for vector search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        embedding float[384]
      )
    `);

    // Create metadata table for chunks
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

    // Create index for faster lookups
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_chunks_document 
      ON document_chunks(document_id)
    `);
  }

  async indexDocument(documentId: number, content: string): Promise<void> {
    await this.embedder.initialize();

    // Delete existing chunks for this document
    const existingChunks = this.db
      .query(`SELECT id FROM document_chunks WHERE document_id = ?`)
      .all(documentId) as Array<{ id: number }>;

    for (const chunk of existingChunks) {
      this.db.run(`DELETE FROM ${this.tableName} WHERE rowid = ?`, chunk.id);
    }

    this.db.run(`DELETE FROM document_chunks WHERE document_id = ?`, documentId);

    // Generate chunk embeddings
    const chunkEmbeddings = await this.embedder.generateChunkEmbeddings(content);

    for (const { chunk, embedding } of chunkEmbeddings) {
      // Insert metadata
      const result = this.db.run(
        `INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, ?, ?)`,
        [documentId, chunk.index, chunk.text]
      );

      const chunkId = result.lastInsertRowid;

      // Insert vector
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

    // Perform KNN search using sqlite-vec
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
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `)
      .all(queryVector, limit) as Array<{
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
```

**Step 2: Delete old vector search**

```bash
rm src/search/vector.ts
```

**Step 3: Commit**

```bash
git add src/search/vector-new.ts
git rm src/search/vector.ts
git commit -m "feat: refactor vector search to use sqlite-vec vec0 tables"
```

---

## Phase 2: Advanced Features

### Task 5: Implement Real Reciprocal Rank Fusion (RRF)

**Files:**
- Create: `src/search/reranking.ts`

**Step 1: Create RRF and reranking module**

```typescript
export interface RankedResult {
  id: string;
  score?: number;
  rank?: number;
  metadata?: Record<string, any>;
}

export interface RRFResult {
  id: string;
  score: number;
  sources: Array<{ source: string; rank: number; originalScore?: number }>;
}

export class ReciprocalRankFusion {
  private k: number;

  constructor(k: number = 60) {
    this.k = k;
  }

  fuse(
    resultSets: Array<{ source: string; results: RankedResult[] }>
  ): RRFResult[] {
    const scores = new Map<string, RRFResult>();

    for (const { source, results } of resultSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const rrfScore = 1 / (this.k + rank + 1); // rank is 0-indexed

        if (!scores.has(result.id)) {
          scores.set(result.id, {
            id: result.id,
            score: 0,
            sources: [],
          });
        }

        const entry = scores.get(result.id)!;
        entry.score += rrfScore;
        entry.sources.push({
          source,
          rank: rank + 1,
          originalScore: result.score,
        });
      }
    }

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score);
  }
}

// Distribution-based score fusion as alternative
export class DistributionBasedScoreFusion {
  fuse(
    resultSets: Array<{ source: string; results: RankedResult[] }>
  ): Array<{ id: string; score: number }> {
    const normalizedSets = resultSets.map(({ source, results }) => {
      const scores = results.map((r) => r.score || 0);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
      const std = Math.sqrt(variance) || 1;

      return {
        source,
        results: results.map((r) => ({
          ...r,
          normalizedScore: ((r.score || 0) - mean) / std,
        })),
      };
    });

    const fusedScores = new Map<string, number>();

    for (const { results } of normalizedSets) {
      for (const result of results) {
        fusedScores.set(
          result.id,
          (fusedScores.get(result.id) || 0) + (result as any).normalizedScore
        );
      }
    }

    return Array.from(fusedScores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);
  }
}
```

**Step 2: Commit**

```bash
git add src/search/reranking.ts
git commit -m "feat: implement Reciprocal Rank Fusion (RRF) and score fusion"
```

---

### Task 6: Add Cross-Encoder Reranking

**Files:**
- Modify: `src/search/reranking.ts`

**Step 1: Add cross-encoder reranker class**

Add to existing `src/search/reranking.ts`:

```typescript
import { pipeline, TextClassificationPipeline } from '@xenova/transformers';

export interface RerankInput {
  query: string;
  document: string;
  id: string;
}

export interface RerankResult {
  id: string;
  document: string;
  score: number;
}

export class CrossEncoderReranker {
  private model: TextClassificationPipeline | null = null;
  private modelName: string;

  constructor(modelName: string = 'Xenova/ms-marco-MiniLM-L-6-v2') {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    if (!this.model) {
      console.log(`Loading reranker model: ${this.modelName}...`);
      this.model = await pipeline('text-classification', this.modelName);
      console.log('Reranker model loaded');
    }
  }

  async rerank(
    query: string,
    documents: RerankInput[],
    topK: number = 5
  ): Promise<RerankResult[]> {
    if (!this.model) {
      await this.initialize();
    }

    // Prepare pairs for cross-encoder
    const pairs = documents.map((doc) => `${query} [SEP] ${doc.document}`);

    // Get relevance scores
    const outputs = await this.model!(pairs);

    // Combine results with scores
    const scored = documents.map((doc, i) => ({
      id: doc.id,
      document: doc.document,
      score: outputs[i].score,
    }));

    // Sort by score and return top-k
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
```

**Step 2: Commit**

```bash
git add src/search/reranking.ts
git commit -m "feat: add cross-encoder reranker with Xenova Transformers"
```

---

### Task 7: Implement Metadata Filtering

**Files:**
- Create: `src/search/filters.ts`

**Step 1: Create metadata filtering module**

```typescript
export interface MetadataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: any;
}

export interface FilterGroup {
  operator: 'and' | 'or';
  filters: (MetadataFilter | FilterGroup)[];
}

export class MetadataQueryBuilder {
  buildWhereClause(
    filter: MetadataFilter | FilterGroup | undefined,
    paramOffset: number = 0
  ): { clause: string; params: any[]; paramCount: number } {
    if (!filter) {
      return { clause: '', params: [], paramCount: 0 };
    }

    if ('operator' in filter && 'filters' in filter) {
      return this.buildGroupClause(filter as FilterGroup, paramOffset);
    }

    return this.buildSingleClause(filter as MetadataFilter, paramOffset);
  }

  private buildGroupClause(
    group: FilterGroup,
    paramOffset: number
  ): { clause: string; params: any[]; paramCount: number } {
    const clauses: string[] = [];
    const params: any[] = [];
    let currentOffset = paramOffset;

    for (const filter of group.filters) {
      const result = this.buildWhereClause(filter, currentOffset);
      if (result.clause) {
        clauses.push(result.clause);
        params.push(...result.params);
        currentOffset = result.paramCount;
      }
    }

    if (clauses.length === 0) {
      return { clause: '', params: [], paramCount: paramOffset };
    }

    const joinOperator = group.operator === 'and' ? ' AND ' : ' OR ';
    return {
      clause: `(${clauses.join(joinOperator)})`,
      params,
      paramCount: currentOffset,
    };
  }

  private buildSingleClause(
    filter: MetadataFilter,
    paramOffset: number
  ): { clause: string; params: any[]; paramCount: number } {
    const paramIndex = paramOffset + 1;
    const jsonPath = `json_extract(metadata, '$.${filter.field}')`;

    switch (filter.operator) {
      case 'eq':
        return {
          clause: `${jsonPath} = ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'ne':
        return {
          clause: `${jsonPath} != ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'gt':
        return {
          clause: `${jsonPath} > ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'gte':
        return {
          clause: `${jsonPath} >= ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'lt':
        return {
          clause: `${jsonPath} < ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'lte':
        return {
          clause: `${jsonPath} <= ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'in':
        const placeholders = (filter.value as any[])
          .map((_, i) => `?${paramIndex + i}`)
          .join(', ');
        return {
          clause: `${jsonPath} IN (${placeholders})`,
          params: filter.value as any[],
          paramCount: paramIndex + (filter.value as any[]).length - 1,
        };
      case 'contains':
        return {
          clause: `json_array_contains(${jsonPath}, ?${paramIndex})`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      default:
        throw new Error(`Unknown operator: ${filter.operator}`);
    }
  }
}

// Helper for common metadata filters
export const MetadataFilters = {
  collection: (name: string): MetadataFilter => ({
    field: 'collection',
    operator: 'eq',
    value: name,
  }),
  dateRange: (start: Date, end: Date): FilterGroup => ({
    operator: 'and',
    filters: [
      { field: 'date', operator: 'gte', value: start.toISOString() },
      { field: 'date', operator: 'lte', value: end.toISOString() },
    ],
  }),
  fileType: (ext: string): MetadataFilter => ({
    field: 'fileType',
    operator: 'eq',
    value: ext,
  }),
  tag: (tag: string): MetadataFilter => ({
    field: 'tags',
    operator: 'contains',
    value: tag,
  }),
};
```

**Step 2: Commit**

```bash
git add src/search/filters.ts
git commit -m "feat: implement metadata filtering with JSON path queries"
```

---

## Phase 3: Integration

### Task 8: Create Unified RAG Pipeline

**Files:**
- Create: `src/search/pipeline.ts`
- Delete: `src/search/hybrid.ts` (old implementation)

**Step 1: Create unified pipeline**

```typescript
import { Database } from 'bun:sqlite';
import { VectorSearch } from './vector-new.js';
import { BM25Search } from './bm25.js';
import {
  ReciprocalRankFusion,
  CrossEncoderReranker,
  RerankInput,
} from './reranking.js';
import { MetadataQueryBuilder, FilterGroup } from './filters.js';

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
    // Load all documents for BM25 indexing
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

    // Step 1: Parallel retrieval
    const [vectorResults, bm25Results] = await Promise.all([
      this.vectorSearch.search(query, limit * 2),
      Promise.resolve(this.bm25.search(query, limit * 2)),
    ]);

    // Step 2: Apply metadata filters if provided
    let filteredVectorResults = vectorResults;
    if (options.filter) {
      filteredVectorResults = await this.filterVectorResults(vectorResults, options.filter);
    }

    // Step 3: Reciprocal Rank Fusion
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

    // Step 4: Fetch full documents
    const results = await this.fetchDocuments(fused.slice(0, rerankTopK));

    // Step 5: Reranking (if enabled)
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

    // Merge rerank scores back into results
    const rerankMap = new Map(reranked.map((r) => [r.id, r.score]));

    return results
      .map((r) => ({
        ...r,
        rerankScore: rerankMap.get(r.id),
        // Combined score: RRF score * rerank score (normalized)
        score: r.score * (rerankMap.get(r.id) || 0.5),
      }))
      .sort((a, b) => b.score - a.score);
  }
}
```

**Step 2: Delete old hybrid search**

```bash
rm src/search/hybrid.ts
```

**Step 3: Commit**

```bash
git add src/search/pipeline.ts
git rm src/search/hybrid.ts
git commit -m "feat: create unified RAG pipeline with RRF and reranking"
```

---

### Task 9: Update Indexer for Per-Chunk Storage

**Files:**
- Modify: `src/indexers/base.ts`

**Step 1: Update imports and VectorSearch reference**

```typescript
import { VectorSearch } from '../search/vector-new.js';
```

**Step 2: Update indexDocument calls to be async**

All calls to `this.vectorSearch.indexDocument()` should be awaited.

**Step 3: Commit**

```bash
git add src/indexers/base.ts
git commit -m "refactor: update indexer to use new vector search"
```

---

### Task 10: Update CLI Commands

**Files:**
- Modify: `src/cli/commands/query.ts`

**Step 1: Update query command to use new pipeline**

```typescript
import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { RAGPipeline } from '../../search/pipeline.js';
import path from 'path';
import os from 'os';

interface QueryOptions {
  limit: string;
  filter?: string;
  rerank?: boolean;
}

export async function queryCommand(query: string, options: QueryOptions) {
  const dbPath = path.join(os.homedir(), '.search-cli', 'index.sqlite');
  const db = new Database(dbPath);
  const pipeline = new RAGPipeline(db, {
    enableReranking: options.rerank !== 'false',
  });

  console.log(chalk.blue(`🔍 RAG Search: "${query}"`));
  console.log(chalk.gray('(BM25 + Vector → RRF → Reranking)\n'));

  try {
    await pipeline.initialize();

    const filter = options.filter ? JSON.parse(options.filter) : undefined;

    const results = await pipeline.search(query, {
      limit: parseInt(options.limit),
      filter,
    });

    if (results.length === 0) {
      console.log(chalk.yellow('No results found.'));
      return;
    }

    console.log(chalk.green(`Found ${results.length} results:\n`));

    for (const result of results) {
      console.log(chalk.bold(result.title || path.basename(result.path)));
      console.log(chalk.gray(`  Path: ${result.path}`));
      console.log(chalk.gray(`  Final Score: ${result.score.toFixed(4)}`));

      if (result.bm25Score) {
        console.log(chalk.gray(`  - BM25 Score: ${result.bm25Score.toFixed(4)}`));
      }
      if (result.vectorScore) {
        console.log(chalk.gray(`  - Vector Distance: ${result.vectorScore.toFixed(4)}`));
      }
      if (result.rerankScore) {
        console.log(chalk.gray(`  - Rerank Score: ${result.rerankScore.toFixed(4)}`));
      }

      console.log(chalk.gray(`  Content: ${result.content.substring(0, 150)}...`));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red(`✗ Search failed: ${error}`));
    process.exit(1);
  }
}
```

**Step 2: Commit**

```bash
git add src/cli/commands/query.ts
git commit -m "feat: update query command with new RAG pipeline"
```

---

## Phase 4: Testing & Verification

### Task 11: Create Basic Tests

**Files:**
- Create: `src/search/__tests__/bm25.test.ts`
- Create: `src/search/__tests__/reranking.test.ts`

**Step 1: Create BM25 tests**

```typescript
import { test, expect } from 'bun:test';
import { BM25Search } from '../bm25';

test('BM25 indexes and searches documents', () => {
  const bm25 = new BM25Search();

  const docs = [
    { id: '1', text: 'The quick brown fox jumps over the lazy dog' },
    { id: '2', text: 'A quick brown dog outpaces a swift fox' },
    { id: '3', text: 'Lazy cats sleep all day long' },
  ];

  bm25.indexDocuments(docs);

  const results = bm25.search('quick brown fox', 2);

  expect(results.length).toBeGreaterThan(0);
  expect(results[0].score).toBeGreaterThan(0);
});

test('BM25 ranks exact matches higher', () => {
  const bm25 = new BM25Search();

  const docs = [
    { id: '1', text: 'machine learning tutorial' },
    { id: '2', text: 'machine learning and deep learning guide' },
    { id: '3', text: 'cooking tutorial' },
  ];

  bm25.indexDocuments(docs);
  const results = bm25.search('machine learning', 3);

  // Documents with machine learning should rank higher
  const doc1Rank = results.findIndex((r) => r.id === '1');
  const doc3Rank = results.findIndex((r) => r.id === '3');

  expect(doc1Rank).toBeLessThan(doc3Rank);
});
```

**Step 2: Create RRF tests**

```typescript
import { test, expect } from 'bun:test';
import { ReciprocalRankFusion } from '../reranking';

test('RRF combines results from multiple sources', () => {
  const rrf = new ReciprocalRankFusion(60);

  const vectorResults = [
    { id: 'doc1', score: 0.9 },
    { id: 'doc2', score: 0.8 },
    { id: 'doc3', score: 0.7 },
  ];

  const bm25Results = [
    { id: 'doc2', score: 2.5 },
    { id: 'doc1', score: 2.0 },
    { id: 'doc4', score: 1.5 },
  ];

  const fused = rrf.fuse([
    { source: 'vector', results: vectorResults },
    { source: 'bm25', results: bm25Results },
  ]);

  // doc1 and doc2 appear in both, should rank highest
  expect(fused.length).toBe(4);
  expect(fused[0].id).toBeOneOf(['doc1', 'doc2']);
  expect(fused[0].score).toBeGreaterThan(fused[3].score);
});

test('RRF with k=60 produces expected scores', () => {
  const rrf = new ReciprocalRankFusion(60);

  const results = [
    {
      source: 'test',
      results: [{ id: 'doc1', score: 1.0 }],
    },
  ];

  const fused = rrf.fuse(results);

  // Score should be 1/(60+1) ≈ 0.016
  expect(fused[0].score).toBeCloseTo(1 / 61, 5);
});
```

**Step 3: Commit**

```bash
git add src/search/__tests__
git commit -m "test: add BM25 and RRF unit tests"
```

---

### Task 12: Final Verification

**Step 1: Run tests**

```bash
bun test
```

**Step 2: Type check**

```bash
bun run build
```

**Step 3: Commit final changes**

```bash
git add -A
git commit -m "chore: final verification and build fixes"
```

---

## Summary

This implementation plan transforms your basic RAG into a production-grade system with:

1. **Real Embeddings**: Xenova Transformers (local, free)
2. **Proper BM25**: Algorithmic BM25 scoring
3. **Native Vector Search**: sqlite-vec with ANN indexing
4. **True RRF**: Reciprocal Rank Fusion, not weighted sum
5. **Cross-Encoder Reranking**: MSMARCO MiniLM for relevance
6. **Metadata Filtering**: JSON path queries
7. **Per-Chunk Indexing**: Granular retrieval

**Estimated Time**: 2-3 hours
**Commits**: 10-12 atomic commits
**Testing**: Comprehensive unit tests included

**Next Steps After Implementation:**
- Evaluate with real queries
- Tune RRF constant (k) and BM25 parameters
- Add query expansion
- Implement caching for embeddings
- Add evaluation metrics (MRR, NDCG)
