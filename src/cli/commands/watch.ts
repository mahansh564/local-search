import chalk from 'chalk';
import { ConfigManager } from '../../utils/config.js';
import { donutConfigDir } from '../../utils/app-paths.js';
import chokidar from 'chokidar';
import { spawn } from 'child_process';
import path from 'path';

export async function watchCommand() {
  const configDir = donutConfigDir();
  const configManager = new ConfigManager(configDir);
  
  const collections = await configManager.getCollections();
  
  if (collections.length === 0) {
    console.log(chalk.yellow('No collections to watch.'));
    return;
  }
  
  console.log(chalk.blue('👁️  Starting file watcher...\n'));
  
  const paths = collections
    .filter(c => c.type === 'files')
    .map(c => c.path);
  
  if (paths.length === 0) {
    console.log(chalk.yellow('No file collections to watch.'));
    return;
  }
  
  console.log(chalk.gray('Watching paths:'));
  paths.forEach(p => console.log(chalk.gray(`  - ${p}`)));
  console.log();
  
  const watcher = chokidar.watch(paths, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
  });
  
  let debounceTimer: NodeJS.Timeout | null = null;
  
  const reindex = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(chalk.blue('\n🔄 Changes detected, reindexing...'));
      const child = spawn('bun', ['run', path.join(process.cwd(), 'src/index.ts'), 'index'], {
        stdio: 'inherit',
      });
      child.on('close', () => {
        console.log(chalk.green('✓ Reindex complete\n'));
      });
    }, 1000);
  };
  
  watcher
    .on('add', (filePath) => {
      console.log(chalk.gray(`+ Added: ${filePath}`));
      reindex();
    })
    .on('change', (filePath) => {
      console.log(chalk.gray(`~ Changed: ${filePath}`));
      reindex();
    })
    .on('unlink', (filePath) => {
      console.log(chalk.gray(`- Removed: ${filePath}`));
      reindex();
    });
  
  console.log(chalk.green('✓ Watching for changes...'));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));
  
  process.on('SIGINT', () => {
    console.log(chalk.blue('\n👋 Stopping watcher...'));
    watcher.close();
    process.exit(0);
  });
}