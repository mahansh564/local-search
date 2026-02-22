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

const COMMON_SYNONYMS: Record<string, string[]> = {
  'search': ['find', 'lookup', 'query', 'retrieve'],
  'find': ['search', 'locate', 'discover', 'get'],
  'error': ['bug', 'issue', 'problem', 'failure'],
  'fix': ['repair', 'resolve', 'correct', 'patch'],
  'create': ['make', 'build', 'generate', 'add'],
  'delete': ['remove', 'erase', 'drop', 'clear'],
  'update': ['modify', 'edit', 'change', 'refresh'],
  'show': ['display', 'view', 'list', 'fetch'],
  'get': ['obtain', 'fetch', 'retrieve', 'acquire'],
  'run': ['execute', 'start', 'launch', 'invoke'],
  'config': ['configuration', 'settings', 'options'],
  'test': ['testing', 'verify', 'check', 'validate'],
  'doc': ['document', 'docs', 'documentation'],
  'note': ['notes', 'memo', 'record'],
  'email': ['mail', 'message', 'emails'],
};

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
    return this.semanticChunkText(text);
  }

  semanticChunkText(text: string): TextChunk[] {
    const sections: string[] = [];
    
    const markdownHeaders = text.split(/(?=^#{1,6}\s)/m);
    for (const section of markdownHeaders) {
      if (section.trim().startsWith('#')) {
        sections.push(section);
        continue;
      }
      
      const paragraphs = section.split(/\n\n+/);
      for (const para of paragraphs) {
        if (para.trim()) sections.push(para);
      }
    }

    if (sections.length === 0) {
      sections.push(text);
    }

    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let currentTokens = 0;
    let chunkIndex = 0;

    for (const section of sections) {
      const sectionTokens = this.encoder.encode(section).length;
      
      if (sectionTokens > this.maxTokens * 1.5) {
        if (currentChunk) {
          chunks.push({
            text: currentChunk.trim(),
            tokens: currentTokens,
            index: chunkIndex++,
          });
          currentChunk = '';
          currentTokens = 0;
        }

        const subSections = this.splitLargeSection(section);
        for (const sub of subSections) {
          chunks.push({
            text: sub.text,
            tokens: sub.tokens,
            index: chunkIndex++,
          });
        }
        continue;
      }

      if (currentTokens + sectionTokens > this.maxTokens && currentChunk) {
        chunks.push({
          text: currentChunk.trim(),
          tokens: currentTokens,
          index: chunkIndex++,
        });
        
        const overlapTokens = this.encoder.encode(currentChunk).slice(-this.overlap);
        currentChunk = this.encoder.decode(overlapTokens) + ' ' + section;
        currentTokens = this.encoder.encode(currentChunk).length;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + section;
        currentTokens += sectionTokens;
      }
    }

    if (currentChunk) {
      chunks.push({
        text: currentChunk.trim(),
        tokens: currentTokens,
        index: chunkIndex,
      });
    }

    return chunks;
  }

  private splitLargeSection(section: string): Array<{ text: string; tokens: number }> {
    const tokens = this.encoder.encode(section);
    if (tokens.length <= this.maxTokens) {
      return [{ text: section, tokens: tokens.length }];
    }

    const effectiveOverlap = Math.min(
      this.overlap,
      Math.max(0, this.maxTokens - 1)
    );
    const step = Math.max(1, this.maxTokens - effectiveOverlap);

    const chunks: Array<{ text: string; tokens: number }> = [];
    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + this.maxTokens, tokens.length);
      let slice = tokens.slice(start, end);
      let text = this.encoder.decode(slice).trim();
      let tokenCount = this.encoder.encode(text).length;

      while (tokenCount > this.maxTokens && slice.length > 1) {
        slice = slice.slice(0, slice.length - 1);
        text = this.encoder.decode(slice).trim();
        tokenCount = this.encoder.encode(text).length;
      }

      chunks.push({ text, tokens: tokenCount });

      if (end >= tokens.length) break;
      start += step;
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

  private static readonly EMBEDDING_DIMENSIONS = 384;

  getEmbeddingDimensions(): number {
    return EmbeddingGenerator.EMBEDDING_DIMENSIONS;
  }

  expandQuery(query: string): string[] {
    const tokens = query.toLowerCase().split(/\s+/);
    const expanded = [query];

    for (const token of tokens) {
      const synonyms = COMMON_SYNONYMS[token];
      if (synonyms) {
        for (const syn of synonyms) {
          const newQuery = query.replace(new RegExp(`\\b${token}\\b`, 'i'), syn);
          if (newQuery !== query && !expanded.includes(newQuery)) {
            expanded.push(newQuery);
          }
        }
      }
    }

    if (tokens.length > 1) {
      expanded.push(tokens.slice(0, -1).join(' '));
      expanded.push(tokens.slice(1).join(' '));
    }

    return expanded;
  }

  async generateExpandedEmbeddings(
    query: string
  ): Promise<{ original: number[]; expanded: number[]; queryVariations: string[] }> {
    const variations = this.expandQuery(query);
    const embeddings = await Promise.all(
      variations.map((v) => this.generateEmbedding(v))
    );

    const firstEmbedding = embeddings[0];
    if (!firstEmbedding || embeddings.length === 0) {
      return {
        original: [],
        expanded: [],
        queryVariations: variations,
      };
    }

    const meanEmbedding = new Array(firstEmbedding.length).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < emb.length; i++) {
        meanEmbedding[i] += emb[i];
      }
    }
    for (let i = 0; i < meanEmbedding.length; i++) {
      meanEmbedding[i] /= embeddings.length;
    }

    return {
      original: firstEmbedding,
      expanded: meanEmbedding,
      queryVariations: variations,
    };
  }
}
