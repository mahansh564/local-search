import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { RAGPipeline } from '../../search/pipeline.js';
import path from 'path';
import os from 'os';

export interface QueryOptions {
  limit: string;
  filter?: string;
  rerank?: string;
  mmr?: boolean;
  mmrLambda?: string;
  expand?: boolean;
  full?: boolean;
  debug?: boolean;
}

export function formatResultOutput(
  result: {
    title?: string;
    path: string;
    score: number;
    content: string;
    fullContent?: string;
    matchedChunk?: string;
    bm25Score?: number;
    vectorScore?: number;
    rerankScore?: number;
    chunkMetadata?: {
      startOffset?: number;
      endOffset?: number;
      sectionTitle?: string;
    };
  },
  options: { full?: boolean }
): string {
  const lines: string[] = [];

  lines.push(chalk.bold(result.title || path.basename(result.path)));
  lines.push(chalk.gray(`  Path: ${result.path}`));
  lines.push(chalk.gray(`  Final Score: ${result.score.toFixed(4)}`));

  if (result.bm25Score) {
    lines.push(chalk.gray(`  - BM25 Score: ${result.bm25Score.toFixed(4)}`));
  }
  if (result.vectorScore) {
    lines.push(chalk.gray(`  - Vector Distance: ${result.vectorScore.toFixed(4)}`));
  }
  if (result.rerankScore) {
    lines.push(chalk.gray(`  - Rerank Score: ${result.rerankScore.toFixed(4)}`));
  }

  if (result.chunkMetadata?.startOffset !== undefined && result.chunkMetadata?.endOffset !== undefined) {
    lines.push(
      chalk.gray(`  - Chunk: ${result.chunkMetadata.startOffset}-${result.chunkMetadata.endOffset}`)
    );
  }
  if (result.chunkMetadata?.sectionTitle) {
    lines.push(chalk.gray(`  - Section: ${result.chunkMetadata.sectionTitle}`));
  }

  if (options.full && result.fullContent) {
    lines.push(chalk.gray(`  Content: ${result.fullContent.substring(0, 300)}...`));
  } else if (result.matchedChunk) {
    lines.push(chalk.gray(`  Matched Chunk: ${result.matchedChunk.substring(0, 150)}...`));
  } else {
    lines.push(chalk.gray(`  Content: ${result.content.substring(0, 150)}...`));
  }

  return lines.join('\n');
}

export async function queryCommand(query: string, options: QueryOptions) {
  const dbPath = path.join(os.homedir(), '.search-cli', 'index.sqlite');
  const db = new Database(dbPath);
  const pipeline = new RAGPipeline(db, {
    enableReranking: options.rerank !== 'false',
    enableMMR: options.mmr ?? false,
    mmrLambda: options.mmrLambda ? parseFloat(options.mmrLambda) : 0.5,
    enableQueryExpansion: options.expand ?? false,
  });

  const features = [];
  if (options.mmr) features.push('MMR');
  if (options.expand) features.push('Query Expansion');
  if (options.full) features.push('Full Docs');
  const featureStr = features.length > 0 ? ` (${features.join(' + ')})` : '';

  console.log(chalk.blue(`🔍 RAG Search: "${query}"${featureStr}`));
  console.log(chalk.gray('(BM25 + Vector → RRF → Reranking)\n'));

  try {
    await pipeline.initialize();

    const filter = options.filter ? JSON.parse(options.filter) : undefined;

    const results = await pipeline.search(query, {
      limit: parseInt(options.limit),
      filter,
      enableMMR: options.mmr,
      enableQueryExpansion: options.expand,
      includeFullDocument: options.full,
      debug: options.debug,
    });

    if (results.length === 0) {
      console.log(chalk.yellow('No results found.'));
      return;
    }

    console.log(chalk.green(`Found ${results.length} results:\n`));

    for (const result of results) {
      console.log(formatResultOutput(result, { full: options.full }));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red(`✗ Search failed: ${error}`));
    process.exit(1);
  }
}
