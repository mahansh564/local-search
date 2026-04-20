import chalk from 'chalk';
import { DatabaseManager } from '../../storage/db.js';
import { CLI_NAME, donutDatabasePath } from '../../utils/app-paths.js';
import path from 'path';

interface SearchOptions {
  limit: string;
  collection?: string;
  // Optional: filter results indexed within the last N days
  recent?: string;
  // Optional: filter by file extension (e.g., md, pdf)
  type?: string;
}

export async function searchCommand(query: string, options: SearchOptions) {
  const dbPath = donutDatabasePath();
  const db = new DatabaseManager(dbPath);
  
  console.log(chalk.blue(`🔍 Searching: "${query}"`));
  console.log();
  
  try {
    const initialResults = db.search(query, parseInt(options.limit), options.collection);

    // Apply additional filtering without changing the search algorithm
    let results = initialResults;
    const recentDays = options.recent ? parseInt(options.recent) : undefined;
    const typeFilter = options.type ? options.type.toLowerCase().replace(/^[.]+/, '') : undefined;

    if ((recentDays && Number.isFinite(recentDays)) || typeFilter) {
      const now = Date.now();
      results = initialResults.filter((r: any) => {
        let ok = true;
        if (recentDays && Number.isFinite(recentDays)) {
          const cutoff = now - recentDays * 24 * 60 * 60 * 1000;
          const indexedAt = r.indexed_at ? new Date(r.indexed_at).getTime() : -Infinity;
          ok = indexedAt >= cutoff;
        }
        if (ok && typeFilter) {
          const ext = (path.extname(r.path || '') || '').toLowerCase().replace(/^\./, '');
          ok = ext === typeFilter;
        }
        return ok;
      });
    }

    results = results as any[];

    if (results.length === 0) {
      console.log(chalk.yellow(`No results for '${query}'. Try different keywords or run '${CLI_NAME} index' to rebuild.`));
      return;
    }

    console.log(chalk.green(`Found ${results.length} results:\n`));
    
    for (const result of results) {
      console.log(chalk.bold(result.title || path.basename(result.path)));
      console.log(chalk.gray(`  Path: ${result.path}`));
      if (typeof result.score === 'number') {
        console.log(chalk.gray(`  Score: ${result.score.toFixed(4)}`));
      } else {
        console.log(chalk.gray(`  Score: N/A`));
      }
      console.log();
    }
  } catch (error) {
    console.error(chalk.red(`✗ Search failed: ${error}`));
    process.exit(1);
  }
}
