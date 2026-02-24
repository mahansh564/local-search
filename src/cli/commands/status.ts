import chalk from 'chalk';
import { DatabaseManager } from '../../storage/db.js';
import { ConfigManager } from '../../utils/config.js';
import path from 'path';
import os from 'os';

export async function statusCommand() {
  const configDir = path.join(os.homedir(), '.search-cli');
  const dbPath = path.join(configDir, 'index.sqlite');
  
  console.log(chalk.blue('📊 Search Index Status\n'));
  
  // Config status
  const configManager = new ConfigManager(configDir);
  const collections = await configManager.getCollections();
  console.log(chalk.bold('Collections:'));
  console.log(`  ${collections.length} configured`);
  
  for (const col of collections) {
    console.log(chalk.gray(`    • ${col.name} (${col.type})`));
  }
  console.log();
  
  // Database status
  try {
    const db = new DatabaseManager(dbPath);
    const stats = db.getStats();
    
    console.log(chalk.bold('Index Statistics:'));
    console.log(`  Documents: ${stats.documentCount.toLocaleString()}`);
    console.log(`  Collections: ${stats.collectionCount}`);
    console.log(`  Database size: ${stats.dbSize}`);
    console.log(`  Last indexed: ${stats.lastIndexed || 'Never'}`);
  } catch (error) {
    console.log(chalk.yellow("Database not initialized. Run 'search-cli init' first."));
  }
}
