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

  private static readonly EMBEDDING_DIMENSIONS = 384;

  getEmbeddingDimensions(): number {
    return EmbeddingGenerator.EMBEDDING_DIMENSIONS;
  }
}
