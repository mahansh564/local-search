import chalk from 'chalk';
import { DatabaseManager } from '../../storage/db.js';
import { ConfigManager } from '../../utils/config.js';
import { CLI_NAME, donutConfigDir, donutDatabasePath } from '../../utils/app-paths.js';

export async function statusCommand() {
  const configDir = donutConfigDir();
  const dbPath = donutDatabasePath();
  
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
    console.log(chalk.yellow(`Database not initialized. Run '${CLI_NAME} init' first.`));
  }
}
