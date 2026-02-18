import readline from 'readline';
import { Database } from 'bun:sqlite';
import { DatabaseManager } from '../../storage/db.js';
import { RAGPipeline } from '../../search/pipeline.js';
import path from 'path';
import os from 'os';

interface SearchResult {
  id: number;
  path: string;
  title: string;
  score: number;
}

export async function interactiveCommand() {
  const dbPath = path.join(os.homedir(), '.search-cli', 'index.sqlite');
  const db = new Database(dbPath);
  const dbManager = new DatabaseManager(dbPath);
  const pipeline = new RAGPipeline(db);

  await pipeline.initialize();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.clear();
  console.log('🔍 Interactive Search Mode');
  console.log('Type your query and press Enter to search.');
  console.log('Commands: :quit, :q - exit, :help - show help\n');

  const search = async (query: string) => {
    if (!query.trim()) return;

    console.clear();
    console.log(`🔍 Query: "${query}"\n`);

    try {
      const results = await pipeline.search(query, { limit: 10 });

      if (results.length === 0) {
        console.log('No results found.\n');
        return;
      }

      console.log(`Found ${results.length} results:\n`);

      results.forEach((result, index: number) => {
        const num = (index + 1).toString().padStart(2, ' ');
        console.log(`${num}. ${result.title || path.basename(result.path)}`);
        console.log(`    Path: ${result.path}`);
        console.log(`    Score: ${result.score.toFixed(4)}`);
        if (result.bm25Score) {
          console.log(`    BM25: ${result.bm25Score.toFixed(4)}`);
        }
        if (result.vectorScore) {
          console.log(`    Vector: ${result.vectorScore.toFixed(4)}`);
        }
        console.log();
      });
    } catch (error) {
      console.error(`Search error: ${error}\n`);
    }
  };

  const prompt = () => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();

      if (trimmed === ':quit' || trimmed === ':q') {
        console.log('\nGoodbye! 👋');
        rl.close();
        return;
      }

      if (trimmed === ':help') {
        console.log('\nCommands:');
        console.log('  :quit, :q  - Exit interactive mode');
        console.log('  :help      - Show this help\n');
        prompt();
        return;
      }

      await search(trimmed);
      prompt();
    });
  };

  prompt();
}