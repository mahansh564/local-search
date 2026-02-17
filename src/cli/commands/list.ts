import chalk from 'chalk';
import { ConfigManager } from '../../utils/config.js';
import path from 'path';
import os from 'os';

export async function listCommand() {
  const configDir = path.join(os.homedir(), '.search-cli');
  const configManager = new ConfigManager(configDir);
  
  const collections = await configManager.getCollections();
  
  if (collections.length === 0) {
    console.log(chalk.yellow('No collections configured.'));
    console.log(chalk.gray('Add a collection with: search-cli add <path>'));
    return;
  }
  
  console.log(chalk.blue('📚 Configured Collections:\n'));
  
  for (const collection of collections) {
    console.log(chalk.bold(collection.name));
    console.log(chalk.gray(`  Path: ${collection.path}`));
    console.log(chalk.gray(`  Type: ${collection.type}`));
    console.log(chalk.gray(`  Glob: ${collection.glob || '**/*'}`));
    console.log();
  }
}