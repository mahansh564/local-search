import chalk from 'chalk';
import { ConfigManager } from '../../utils/config.js';
import { Indexer } from '../../indexers/base.js';
import path from 'path';
import os from 'os';

interface IndexOptions {
  collection?: string;
}

export async function indexCommand(options: IndexOptions) {
  const configDir = path.join(os.homedir(), '.search-cli');
  const configManager = new ConfigManager(configDir);
  
  console.log(chalk.blue('📦 Building search index...\n'));
  
  const collections = await configManager.getCollections();
  const targetCollections = options.collection 
    ? collections.filter(c => c.name === options.collection)
    : collections;
  
  if (targetCollections.length === 0) {
    console.log(chalk.yellow(options.collection 
      ? `Collection "${options.collection}" not found.` 
      : 'No collections configured.'));
    return;
  }
  
  const dbPath = path.join(configDir, 'index.sqlite');
  const indexer = new Indexer(dbPath);
  
  for (const collection of targetCollections) {
    console.log(chalk.blue(`Indexing: ${collection.name}`));
    console.log(chalk.gray(`  Path: ${collection.path}`));
    
    try {
      await indexer.indexCollection(collection);
      console.log(chalk.green(`✓ Completed: ${collection.name}\n`));
    } catch (error) {
      console.error(chalk.red(`✗ Failed to index ${collection.name}: ${error}\n`));
    }
  }
  
  console.log(chalk.green('🎉 Indexing complete!'));
}