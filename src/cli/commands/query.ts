import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { RAGPipeline } from '../../search/pipeline.js';
import path from 'path';
import os from 'os';

interface QueryOptions {
  limit: string;
  filter?: string;
  rerank?: string;
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