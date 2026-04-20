import chalk from 'chalk';
import { DatabaseManager } from '../../storage/db.js';
import { ConfigManager } from '../../utils/config.js';
import { CLI_NAME, donutConfigDir, donutDatabasePath } from '../../utils/app-paths.js';
import fs from 'fs';

export async function initCommand() {
  console.log(chalk.blue(`🍩 Initializing ${CLI_NAME}...`));

  const configDir = donutConfigDir();
  const dbPath = donutDatabasePath();
  
  // Create config directory
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(chalk.green(`✓ Created config directory: ${configDir}`));
  }
  
  // Initialize config
  const configManager = new ConfigManager(configDir);
  await configManager.init();
  console.log(chalk.green(`✓ Created default configuration`));
  
  // Initialize database
  const db = new DatabaseManager(dbPath);
  db.init();
  console.log(chalk.green(`✓ Created database: ${dbPath}`));
  
  console.log(chalk.blue(`\n🎉 ${CLI_NAME} initialized successfully!`));
  console.log(chalk.gray(`\nNext steps:`));
  console.log(chalk.gray(`  1. Add a collection: ${CLI_NAME} add <path>`));
  console.log(chalk.gray(`  2. Build the index: ${CLI_NAME} index`));
  console.log(chalk.gray(`  3. Start searching: ${CLI_NAME} search <query>`));
}