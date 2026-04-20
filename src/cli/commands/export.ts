import chalk from 'chalk';
import { Database } from 'bun:sqlite';
import { RAGPipeline } from '../../search/pipeline.js';
import { CLI_NAME, donutDatabasePath } from '../../utils/app-paths.js';
import fs from 'fs';
import path from 'path';

interface ExportOptions {
  format: string;
  output?: string;
}

export async function exportCommand(query: string, options: ExportOptions) {
  const dbPath = donutDatabasePath();
  const db = new Database(dbPath);
  const pipeline = new RAGPipeline(db);

  await pipeline.initialize();

  console.log(chalk.blue(`🔍 Searching for export: "${query}"`));

  try {
    const results = await pipeline.search(query, { limit: 100 });

    if (results.length === 0) {
      console.log(chalk.yellow(`No results for '${query}'. Try different keywords or run '${CLI_NAME} index' to rebuild.`));
      return;
    }

    let output: string;

    switch (options.format) {
      case 'json':
        output = JSON.stringify(results, null, 2);
        break;
      case 'csv':
        output = convertToCSV(results);
        break;
      case 'markdown':
      default:
        output = convertToMarkdown(results);
        break;
    }

    if (options.output) {
      fs.writeFileSync(options.output, output);
      console.log(chalk.green(`✓ Exported ${results.length} results to ${options.output}`));
    } else {
      console.log('\n' + output);
    }
  } catch (error) {
    console.error(chalk.red(`✗ Export failed: ${error}`));
    process.exit(1);
  }
}

function convertToCSV(results: Array<{ title: string; path: string; score: number }>): string {
  const header = 'Title,Path,Score\n';
  const rows = results.map(r => 
    `"${r.title.replace(/"/g, '""')}","${r.path}",${r.score.toFixed(4)}`
  ).join('\n');
  return header + rows;
}

function convertToMarkdown(results: Array<{ title: string; path: string; score: number }>): string {
  let md = '# Search Results\n\n';
  md += '| # | Title | Path | Score |\n';
  md += '|---|-------|------|-------|\n';
  
  results.forEach((r, i) => {
    md += `| ${i + 1} | ${r.title} | \`${r.path}\` | ${r.score.toFixed(4)} |\n`;
  });
  
  return md;
}
