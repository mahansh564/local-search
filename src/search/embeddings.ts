import { encodingForModel } from 'js-tiktoken';

export class EmbeddingGenerator {
  private encoder: ReturnType<typeof encodingForModel>;

  constructor() {
    this.encoder = encodingForModel('text-embedding-ada-002');
  }

  generateEmbedding(text: string): number[] {
    const tokens = this.encoder.encode(text);

    const embedding: number[] = new Array(384).fill(0);

    for (let i = 0; i < tokens.length && i < 512; i++) {
      const token = tokens[i];
      if (typeof token !== 'number') continue;

      for (let j = 0; j < 384; j++) {
        const hash = this.xorShift(token * 384 + j);
        embedding[j] = (embedding[j] ?? 0) + (hash % 1000) / 1000;
      }
    }

    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = (embedding[i] ?? 0) / magnitude;
      }
    }

    return embedding;
  }

  private xorShift(seed: number): number {
    let x = seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return Math.abs(x);
  }

  chunkText(text: string, maxTokens: number = 512, overlap: number = 50): string[] {
    const tokens = this.encoder.encode(text);
    const chunks: string[] = [];
    
    let start = 0;
    while (start < tokens.length) {
      const end = Math.min(start + maxTokens, tokens.length);
      const chunkTokens = tokens.slice(start, end);
      const chunkText = this.encoder.decode(chunkTokens);
      chunks.push(chunkText);
      
      if (end >= tokens.length) break;
      start = end - overlap;
    }
    
    return chunks;
  }
}