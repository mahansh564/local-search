import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { HybridSearch } from '../../search/hybrid.js';
import path from 'path';
import os from 'os';

interface QueryOptions {
  limit: string;
}

export async function queryCommand(query: string, options: QueryOptions) {
  const dbPath = path.join(os.homedir(), '.search-cli', 'index.sqlite');
  const db = new Database(dbPath);
  const hybridSearch = new HybridSearch(db);

  console.log(chalk.blue(`🔍 Hybrid searching: "${query}"`));
  console.log(chalk.gray('(Combining FTS5 + Vector search with RRF)\n'));

  try {
    const results = hybridSearch.search(query, parseInt(options.limit));

    if (results.length === 0) {
      console.log(chalk.yellow('No results found.'));
      return;
    }

    console.log(chalk.green(`Found ${results.length} results:\n`));

    for (const result of results) {
      console.log(chalk.bold(result.title || path.basename(result.path)));
      console.log(chalk.gray(`  Path: ${result.path}`));
      console.log(chalk.gray(`  Combined Score: ${result.combinedScore.toFixed(4)}`));
      console.log(chalk.gray(`  - FTS Score: ${result.ftsScore.toFixed(4)}`));
      console.log(chalk.gray(`  - Vector Distance: ${result.vectorDistance.toFixed(4)}`));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red(`✗ Hybrid search failed: ${error}`));
    process.exit(1);
  }
}