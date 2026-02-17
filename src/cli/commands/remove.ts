import chalk from 'chalk';
import { ConfigManager } from '../../utils/config.js';
import path from 'path';
import os from 'os';

export async function removeCommand(name: string) {
  const configDir = path.join(os.homedir(), '.search-cli');
  const configManager = new ConfigManager(configDir);
  
  console.log(chalk.blue(`🗑️ Removing collection: ${name}`));
  
  try {
    await configManager.removeCollection(name);
    console.log(chalk.green(`✓ Collection "${name}" removed`));
  } catch (error) {
    console.error(chalk.red(`✗ Failed to remove collection: ${error}`));
    process.exit(1);
  }
}