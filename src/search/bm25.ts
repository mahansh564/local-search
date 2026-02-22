interface BM25Document {
  id: string;
  text: string;
}

interface BM25Stats {
  totalDocs: number;
  avgDocLength: number;
  docLengths: Map<string, number>;
  termFrequencies: Map<string, Map<string, number>>;
  docFrequencies: Map<string, number>;
}

const STOPWORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

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

      const termCounts = new Map<string, number>();
      for (const token of tokens) {
        termCounts.set(token, (termCounts.get(token) || 0) + 1);
      }

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

      const idf = Math.log(
        (this.stats.totalDocs - df + 0.5) / (df + 0.5) + 1
      );

      const termDocFreqs = this.stats.termFrequencies.get(term);
      if (!termDocFreqs) continue;

      for (const [docId, tf] of termDocFreqs) {
        const docLength = this.stats.docLengths.get(docId) || 0;
        const normalizedLength = docLength / this.stats.avgDocLength;

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
      .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  }
}
