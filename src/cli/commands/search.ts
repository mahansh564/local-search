import chalk from 'chalk';
import { DatabaseManager } from '../../storage/db.js';
import path from 'path';
import os from 'os';

interface SearchOptions {
  limit: string;
  collection?: string;
}

export async function searchCommand(query: string, options: SearchOptions) {
  const dbPath = path.join(os.homedir(), '.search-cli', 'index.sqlite');
  const db = new DatabaseManager(dbPath);
  
  console.log(chalk.blue(`🔍 Searching: "${query}"`));
  console.log();
  
  try {
    const results = db.search(query, parseInt(options.limit), options.collection);
    
    if (results.length === 0) {
      console.log(chalk.yellow('No results found.'));
      return;
    }
    
    console.log(chalk.green(`Found ${results.length} results:\n`));
    
    for (const result of results) {
      console.log(chalk.bold(result.title || path.basename(result.path)));
      console.log(chalk.gray(`  Path: ${result.path}`));
      console.log(chalk.gray(`  Score: ${result.score.toFixed(4)}`));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red(`✗ Search failed: ${error}`));
    process.exit(1);
  }
}