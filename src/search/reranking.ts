import { AutoTokenizer, AutoModelForSequenceClassification, PreTrainedModel, PreTrainedTokenizer } from '@xenova/transformers';

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
  private model: PreTrainedModel | null = null;
  private tokenizer: PreTrainedTokenizer | null = null;
  private modelName: string;

  constructor(modelName: string = 'Xenova/ms-marco-MiniLM-L-6-v2') {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    if (!this.model || !this.tokenizer) {
      console.log(`Loading reranker model: ${this.modelName}...`);
      const [model, tokenizer] = await Promise.all([
        AutoModelForSequenceClassification.from_pretrained(this.modelName),
        AutoTokenizer.from_pretrained(this.modelName),
      ]);
      this.model = model;
      this.tokenizer = tokenizer;
      console.log('Reranker model loaded');
    }
  }

  async rerank(
    query: string,
    documents: RerankInput[],
    topK: number = 5
  ): Promise<RerankResult[]> {
    if (!this.model || !this.tokenizer) {
      await this.initialize();
    }

    // Tokenize query-document pairs using text_pair for cross-encoder
    const queries = documents.map(() => query);
    const docs = documents.map((doc) => doc.document);

    const features = this.tokenizer!(queries, {
      text_pair: docs,
      padding: true,
      truncation: true,
    });

    // Get raw logits from the model
    const outputs = await this.model!(features);
    
    // Extract logits - cross-encoder outputs raw scores
    const logits = outputs.logits.data;
    const numClasses = outputs.logits.dims[outputs.logits.dims.length - 1] || 1;

    const scored = documents.map((doc, i) => {
      // For binary classification models, use the positive class logit as the score
      // For regression models, the single output is the score
      let score: number;
      if (numClasses === 1) {
        // Regression model - single output
        score = logits[i] as number;
      } else {
        // Classification model - use the logit for the relevance class
        // For binary classification, index 1 is typically the positive class
        score = logits[i * numClasses + 1] as number;
      }
      
      return {
        id: doc.id,
        document: doc.document,
        score,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

export class ScoreNormalizer {
  static minMaxNormalize(results: RankedResult[]): RankedResult[] {
    if (results.length === 0) return results;
    
    const scores = results.map(r => r.score ?? 0);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;
    
    if (range === 0) {
      return results.map(r => ({ ...r, score: 1 }));
    }
    
    return results.map(r => ({
      ...r,
      score: (r.score ?? 0 - min) / range
    }));
  }

  static zScoreNormalize(results: RankedResult[]): RankedResult[] {
    if (results.length === 0) return results;
    
    const scores = results.map(r => r.score ?? 0);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
    const std = Math.sqrt(variance) || 1;
    
    return results.map(r => ({
      ...r,
      score: ((r.score ?? 0) - mean) / std
    }));
  }

  static rankNormalize(results: RankedResult[]): RankedResult[] {
    if (results.length === 0) return results;
    
    const sorted = [...results].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const scoreToRank = new Map<string, number>();
    
    sorted.forEach((r, i) => {
      scoreToRank.set(r.id, i + 1);
    });
    
    const maxRank = results.length;
    return results.map(r => ({
      ...r,
      score: 1 - ((scoreToRank.get(r.id) ?? maxRank) - 1) / (maxRank - 1)
    }));
  }
}
