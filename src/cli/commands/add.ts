import chalk from 'chalk';
import { ConfigManager } from '../../utils/config.js';
import { DatabaseManager } from '../../storage/db.js';
import { AppleNotesIndexer } from '../../indexers/apple-notes.js';
import path from 'path';
import os from 'os';

interface AddOptions {
  name?: string;
  type: string;
  glob: string;
  notesDb?: string;
  visionModel?: string;
}

export async function addCommand(collectionPath: string, options: AddOptions) {
  const configDir = path.join(os.homedir(), '.search-cli');
  const configManager = new ConfigManager(configDir);
  
  // Resolve full path
  const resolvedPath = path.resolve(collectionPath);
  
  // Generate name if not provided
  const name = options.name || path.basename(resolvedPath);
  
  console.log(chalk.blue(`➕ Adding collection: ${name}`));

  if (options.type === 'apple-notes') {
    const indexer = new AppleNotesIndexer(options.notesDb);

    if (!indexer.isAvailable()) {
      console.error(chalk.red('✗ Apple Notes database not found'));
      console.error(chalk.gray('\nSearched paths:'));
      console.error(chalk.gray('  ~/Library/Notes/Notes.db'));
      console.error(chalk.gray('  ~/Library/Containers/com.apple.Notes/Data/Library/Notes/Notes.db'));
      console.error(chalk.gray('  ~/Library/Containers/com.apple.Notes/Data/Library/Notes/NotesV7.storedata'));
      console.error(chalk.gray('  ~/Library/Group Containers/group.com.apple.notes/Notes.db'));
      console.error(chalk.gray('  ~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite'));
      console.error(chalk.yellow('\nPossible solutions:'));
      console.error(chalk.yellow('  1. Grant Full Disk Access to Terminal/IDE in System Settings > Privacy & Security'));
      console.error(chalk.yellow('  2. Run: sudo ls ~/Library/Containers/com.apple.Notes/Data/Library/Notes/'));
      console.error(chalk.yellow('  3. Check if Notes.app has any notes created'));
      console.error(chalk.yellow('  4. Specify custom path: --notes-db /path/to/Notes.db'));
      process.exit(1);
    }

    console.log(chalk.green(`✓ Found Apple Notes at: ${indexer.getNotesPath()}`));
  }

  await configManager.addCollection({
    name,
    path: resolvedPath,
    type: options.type as 'files' | 'email' | 'apple-notes' | 'image',
    glob: options.glob,
    notesDb: options.notesDb,
    visionModel: options.visionModel,
  });

  console.log(chalk.green(`✓ Collection "${name}" added`));
  console.log(chalk.gray(`  Path: ${resolvedPath}`));
  console.log(chalk.gray(`  Type: ${options.type}`));
  if (options.type !== 'apple-notes') {
    console.log(chalk.gray(`  Glob: ${options.glob}`));
  }
  if (options.type === 'image' && options.visionModel) {
    console.log(chalk.gray(`  Vision Model: ${options.visionModel}`));
  }
  console.log(chalk.gray(`\nRun "search-cli index" to index this collection.`));
}
