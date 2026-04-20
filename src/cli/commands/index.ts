import chalk from 'chalk';
import { ConfigManager } from '../../utils/config.js';
import { Indexer } from '../../indexers/base.js';
import { DatabaseManager } from '../../storage/db.js';
import { CLI_NAME, donutConfigDir, donutDatabasePath } from '../../utils/app-paths.js';

interface IndexOptions {
  collection?: string;
}

export async function indexCommand(options: IndexOptions) {
  const configDir = donutConfigDir();
  const configManager = new ConfigManager(configDir);
  
  console.log(chalk.blue('📦 Building search index...\n'));
  
  const collections = await configManager.getCollections();
  const targetCollections = options.collection 
    ? collections.filter(c => c.name === options.collection)
    : collections;
  
  if (targetCollections.length === 0) {
    console.log(chalk.yellow(options.collection
      ? `Collection '${options.collection}' not found. Run '${CLI_NAME} list' to see available collections.`
      : `No collections configured. Run '${CLI_NAME} list' to see available collections.`));
    return;
  }
  
  const dbPath = donutDatabasePath();
  const dbManager = new DatabaseManager(dbPath);
  dbManager.init();
  const removed = dbManager.dedupeDocumentsByPath();
  if (removed > 0) {
    console.log(chalk.yellow(`Removed ${removed} duplicate document rows by path.`));
  }
  const canonicalized = dbManager.canonicalizeAppleNotesPaths();
  if (canonicalized > 0) {
    console.log(
      chalk.yellow(
        `Removed ${canonicalized} legacy Apple Notes numeric path entries.`
      )
    );
  }
  // Get vision model from first collection that has one (if any)
  const visionModel = collections
    .filter(c => c.visionModel)
    .map(c => c.visionModel)[0];
  
  const indexer = new Indexer(dbPath, visionModel);
  
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
