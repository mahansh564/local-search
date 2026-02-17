import chalk from 'chalk';
import { DatabaseManager } from '../../storage/db.js';
import { ConfigManager } from '../../utils/config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function initCommand() {
  console.log(chalk.blue('🔍 Initializing search-cli...'));
  
  const configDir = path.join(os.homedir(), '.search-cli');
  const dbPath = path.join(configDir, 'index.sqlite');
  
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
  
  console.log(chalk.blue('\n🎉 search-cli initialized successfully!'));
  console.log(chalk.gray(`\nNext steps:`));
  console.log(chalk.gray(`  1. Add a collection: search-cli add <path>`));
  console.log(chalk.gray(`  2. Build the index: search-cli index`));
  console.log(chalk.gray(`  3. Start searching: search-cli search <query>`));
}