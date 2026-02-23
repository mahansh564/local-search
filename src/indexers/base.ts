import '../lib/sqlite-setup.js';
import { DatabaseManager } from '../storage/db.js';
import { VectorSearch } from '../search/vector-new.js';
import { EmailIndexer } from './email.js';
import { AppleNotesIndexer } from './apple-notes.js';
import { Database } from 'bun:sqlite';
import { globby } from 'globby';
import { buildDocumentMetadata, normalizeContent } from './content-utils.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface Collection {
  name: string;
  path: string;
  type: 'files' | 'email' | 'apple-notes';
  glob: string;
  emailFormat?: 'maildir' | 'mbox' | 'eml';
  notesDb?: string;
}

interface Document {
  path: string;
  title: string;
  content: string;
  hash: string;
}

export class Indexer {
  private db: DatabaseManager;
  private vectorSearch: VectorSearch;
  private emailIndexer: EmailIndexer;
  private appleNotesIndexer: AppleNotesIndexer;

  constructor(dbPath: string) {
    this.db = new DatabaseManager(dbPath);
    const sqliteDb = new Database(dbPath);
    this.vectorSearch = new VectorSearch(sqliteDb);
    this.emailIndexer = new EmailIndexer();
    this.appleNotesIndexer = new AppleNotesIndexer();
  }

  async initialize(): Promise<void> {}

  async indexCollection(collection: Collection): Promise<void> {
    if (collection.type === 'apple-notes') {
      await this.indexAppleNotesCollection(collection);
    } else if (collection.type === 'email') {
      await this.indexEmailCollection(collection);
    } else {
      await this.indexFileCollection(collection);
    }
  }

  private async indexAppleNotesCollection(collection: Collection): Promise<void> {
    const indexer = new AppleNotesIndexer(collection.notesDb);

    if (!indexer.isAvailable()) {
      console.warn('  Apple Notes database not found');
      if (collection.notesDb) {
        console.warn(`  Custom path: ${collection.notesDb}`);
      }
      return;
    }

    console.log(`  Apple Notes DB: ${indexer.getNotesPath()}`);

    const notes = indexer.indexNotes();

    for (const note of notes) {
      try {
        const rawContent = `${note.title}\n\n${note.content}`;
        const normalized = normalizeContent(rawContent);
        const hash = crypto.createHash('sha256').update(normalized).digest('hex');
        const metadata = buildDocumentMetadata('apple-notes', normalized);

        const result = this.db.insertDocument({
          path: `apple-notes://${note.id}`,
          title: note.title,
          content: normalized,
          hash,
          metadata,
        });

        if (result.updated && this.vectorSearch.isAvailable()) {
          await this.vectorSearch.indexDocument(result.id, normalized);
        }
      } catch (error) {
        console.warn(`  Failed to index note ${note.id}: ${error}`);
      }
    }

    console.log(`  Indexed ${notes.length} Apple Notes`);
  }

  private async indexFileCollection(collection: Collection): Promise<void> {
    const files = await this.findFiles(collection);

    for (const filePath of files) {
      try {
        await this.indexFile(filePath, collection);
      } catch (error) {
        console.warn(`Failed to index ${filePath}: ${error}`);
      }
    }
  }

  private async indexEmailCollection(collection: Collection): Promise<void> {
    const format = collection.emailFormat || this.detectEmailFormat(collection.path);
    const emails = await this.emailIndexer.indexCollection({
      name: collection.name,
      path: collection.path,
      format,
    });

    for (const email of emails) {
      try {
        const rawContent = `${email.subject}\n\nFrom: ${email.from}\nTo: ${email.to.join(', ')}\nDate: ${email.date.toISOString()}\n\n${email.content}`;
        const normalized = normalizeContent(rawContent);
        const hash = crypto.createHash('sha256').update(normalized).digest('hex');
        const metadata = buildDocumentMetadata('email', normalized);

        const result = this.db.insertDocument({
          path: email.path,
          title: email.subject,
          content: normalized,
          hash,
          metadata,
        });

        if (result.updated && this.vectorSearch.isAvailable()) {
          await this.vectorSearch.indexDocument(result.id, normalized);
        }
      } catch (error) {
        console.warn(`Failed to index email ${email.messageId}: ${error}`);
      }
    }

    console.log(`  Indexed ${emails.length} emails`);
  }

  private detectEmailFormat(emailPath: string): 'maildir' | 'mbox' | 'eml' {
    if (fs.existsSync(path.join(emailPath, 'cur')) || fs.existsSync(path.join(emailPath, 'new'))) {
      return 'maildir';
    }
    if (fs.statSync(emailPath).isFile() && emailPath.endsWith('.mbox')) {
      return 'mbox';
    }
    return 'eml';
  }

  private async findFiles(collection: Collection): Promise<string[]> {
    if (collection.type === 'files') {
      const pattern = path.join(collection.path, collection.glob || '**/*');
      return globby([pattern, '!**/node_modules/**', '!.git/**']);
    }
    return [];
  }

  private async indexFile(filePath: string, collection: Collection): Promise<void> {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const normalized = normalizeContent(rawContent);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    const metadata = buildDocumentMetadata('files', normalized);

    const title = this.extractTitle(normalized, filePath);

    const result = this.db.insertDocument({
      path: filePath,
      title,
      content: normalized,
      hash,
      metadata,
    });

    if (result.updated && this.vectorSearch.isAvailable()) {
      await this.vectorSearch.indexDocument(result.id, normalized);
    }
  }

  private extractTitle(content: string, filePath: string): string {
    const h1Match = content.match(/^# (.+)$/m);
    if (h1Match && h1Match[1]) return h1Match[1].trim();
    return path.basename(filePath);
  }
}
