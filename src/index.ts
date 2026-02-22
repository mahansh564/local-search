#!/usr/bin/env bun
import './lib/sqlite-setup.js';
import { Command } from 'commander';
import { initCommand } from './cli/commands/init.js';
import { addCommand } from './cli/commands/add.js';
import { removeCommand } from './cli/commands/remove.js';
import { listCommand } from './cli/commands/list.js';
import { searchCommand } from './cli/commands/search.js';
import { vsearchCommand } from './cli/commands/vsearch.js';
import { queryCommand } from './cli/commands/query.js';
import { indexCommand } from './cli/commands/index.js';
import { statusCommand } from './cli/commands/status.js';
import { interactiveCommand } from './cli/commands/interactive.js';
import { watchCommand } from './cli/commands/watch.js';
import { exportCommand } from './cli/commands/export.js';
import { askCommand } from './cli/commands/ask.js';

const program = new Command();

program
  .name('search-cli')
  .description('Terminal CLI search application for local notes, files, emails, and Apple Notes')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize search database and configuration')
  .action(initCommand);

program
  .command('add')
  .description('Add a collection (files, email, or apple-notes)')
  .argument('<path>', 'Path to directory or file (use "apple-notes" for Apple Notes)')
  .option('-n, --name <name>', 'Collection name')
  .option('-t, --type <type>', 'Collection type (files|email|apple-notes)', 'files')
  .option('-g, --glob <pattern>', 'Glob pattern for file matching', '**/*')
  .option('--notes-db <path>', 'Custom path to Apple Notes database (for apple-notes type)')
  .action(addCommand);

program
  .command('remove')
  .description('Remove a collection')
  .argument('<name>', 'Collection name to remove')
  .action(removeCommand);

program
  .command('list')
  .description('List all collections')
  .action(listCommand);

program
  .command('search')
  .description('Search documents using FTS5 (fast keyword search)')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Maximum results', '10')
  .option('-c, --collection <name>', 'Filter by collection')
  .action(searchCommand);

program
  .command('vsearch')
  .description('Search documents using vector embeddings (semantic search)')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Maximum results', '10')
  .action(vsearchCommand);

program
  .command('query')
  .description('Hybrid search using FTS5 + Vector with RRF ranking')
  .argument('<query>', 'Search query')
  .option('-l, --limit <n>', 'Maximum results', '10')
  .option('--rerank <bool>', 'Enable reranking', 'true')
  .option('--mmr', 'Enable MMR (Maximal Marginal Relevance) for diverse results')
  .option('--mmr-lambda <float>', 'MMR lambda (0=diversity, 1=relevance)', '0.5')
  .option('--expand', 'Enable query expansion with synonyms')
  .option('--full', 'Include full document content in results')
  .action(queryCommand);

program
  .command('index')
  .description('Rebuild search index')
  .option('-c, --collection <name>', 'Index specific collection only')
  .action(indexCommand);

program
  .command('status')
  .description('Show index health and statistics')
  .action(statusCommand);

program
  .command('interactive')
  .alias('i')
  .description('Start interactive search mode')
  .action(interactiveCommand);

program
  .command('watch')
  .description('Watch collections for changes and auto-reindex')
  .action(watchCommand);

program
  .command('export')
  .description('Export search results to file')
  .argument('<query>', 'Search query')
  .option('-f, --format <format>', 'Export format (json|csv|markdown)', 'markdown')
  .option('-o, --output <file>', 'Output file path')
  .action(exportCommand);

program
  .command('ask')
  .description('Ask questions about your indexed documents using LLM')
  .argument('<question>', 'Question to ask about your documents')
  .option('-l, --limit <n>', 'Maximum documents to use as context', '5')
  .option('-m, --model <model>', 'Ollama model to use')
  .option('--no-stream', 'Disable streaming response')
  .action(askCommand);

program.parse();
