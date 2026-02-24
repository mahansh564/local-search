import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { VectorSearch } from '../../search/vector-new.js';
import path from 'path';
import os from 'os';

interface VSearchOptions {
  limit: string;
}

export async function vsearchCommand(query: string, options: VSearchOptions) {
  const dbPath = path.join(os.homedir(), '.search-cli', 'index.sqlite');
  const db = new Database(dbPath);
  const vectorSearch = new VectorSearch(db);

  if (!vectorSearch.isAvailable()) {
    console.log(chalk.yellow('⚠️  Vector search is not available. Make sure sqlite-vec is installed.'));
    return;
  }

  console.log(chalk.blue(`🔍 Vector searching: "${query}"`));
  console.log();

  try {
    const results = await vectorSearch.search(query, parseInt(options.limit));

    if (results.length === 0) {
      console.log(chalk.yellow(`No results for '${query}'. Try different keywords or run 'search-cli index' to rebuild.`));
      return;
    }

    console.log(chalk.green(`Found ${results.length} results:\n`));

    for (const result of results) {
      console.log(chalk.bold(result.title || path.basename(result.path)));
      console.log(chalk.gray(`  Path: ${result.path}`));
      console.log(chalk.gray(`  Distance: ${result.distance.toFixed(4)}`));
      console.log(chalk.gray(`  Chunk: ${result.chunkIndex}`));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red(`✗ Vector search failed: ${error}`));
    process.exit(1);
  }
}
