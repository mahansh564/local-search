import { pipeline, TextClassificationPipeline } from '@xenova/transformers';

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
        if (!result) continue;
        
        const rrfScore = 1 / (this.k + rank + 1);

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

    const pairs = documents.map((doc) => `${query} [SEP] ${doc.document}`);
    const outputs = await this.model!(pairs) as Array<{ score: number } | undefined>;

    const scored = documents.map((doc, i) => {
      const output = outputs[i];
      return {
        id: doc.id,
        document: doc.document,
        score: output?.score ?? 0,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
