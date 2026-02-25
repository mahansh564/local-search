import '../lib/sqlite-setup.js';
import { DatabaseManager } from '../storage/db.js';
import { VectorSearch } from '../search/vector-new.js';
import { EmailIndexer } from './email.js';
import { AppleNotesIndexer } from './apple-notes.js';
import { ImageIndexer, isImageFile, type ImageMetadata } from './image.js';
import { Database } from 'bun:sqlite';
import { globby } from 'globby';
import { buildDocumentMetadata, normalizeContent, type DocumentMetadata } from './content-utils.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface Collection {
  name: string;
  path: string;
  type: 'files' | 'email' | 'apple-notes' | 'image';
  glob: string;
  emailFormat?: 'maildir' | 'mbox' | 'eml';
  notesDb?: string;
  visionModel?: string;
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
  private imageIndexer: ImageIndexer;

  constructor(dbPath: string, visionModel?: string) {
    this.db = new DatabaseManager(dbPath);
    const sqliteDb = new Database(dbPath);
    this.vectorSearch = new VectorSearch(sqliteDb);
    this.emailIndexer = new EmailIndexer();
    this.appleNotesIndexer = new AppleNotesIndexer();
    this.imageIndexer = new ImageIndexer({ model: visionModel });
  }

  async initialize(): Promise<void> {}

  async indexCollection(collection: Collection): Promise<void> {
    if (collection.type === 'apple-notes') {
      await this.indexAppleNotesCollection(collection);
    } else if (collection.type === 'email') {
      await this.indexEmailCollection(collection);
    } else if (collection.type === 'image') {
      await this.indexImageCollection(collection);
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
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    let imageCount = 0;
    let textCount = 0;

    for (const filePath of files) {
      try {
        const ext = path.extname(filePath).toLowerCase();
        if (imageExtensions.has(ext)) {
          await this.indexImageFile(filePath, collection);
          imageCount++;
        } else {
          await this.indexTextFile(filePath, collection);
          textCount++;
        }
      } catch (error) {
        console.warn(`Failed to index ${filePath}: ${error}`);
      }
    }

    if (imageCount > 0) {
      console.log(`  Indexed ${imageCount} images`);
    }
  }

  private async indexImageCollection(collection: Collection): Promise<void> {
    // Check if vision model is available
    const isAvailable = await this.imageIndexer.checkAvailability();
    if (!isAvailable) {
      console.warn(`  Vision model not available. Pull it with: ollama pull ${this.imageIndexer.getModel()}`);
      return;
    }

    console.log(`  Using vision model: ${this.imageIndexer.getModel()}`);

    // Find all image files in the directory
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    const pattern = collection.glob || '**/*.{png,jpg,jpeg,gif,webp}';
    const fullPattern = path.join(collection.path, pattern);
    
    const files = await globby([fullPattern, '!**/node_modules/**', '!.git/**']);
    const imageFiles = files.filter(f => imageExtensions.has(path.extname(f).toLowerCase()));

    console.log(`  Found ${imageFiles.length} images to index`);

    for (let i = 0; i < imageFiles.length; i++) {
      const filePath = imageFiles[i];
      console.log(`  [${i + 1}/${imageFiles.length}] Indexing: ${path.basename(filePath)}`);
      
      try {
        await this.indexImageFile(filePath, collection);
      } catch (error) {
        console.warn(`  Failed to index ${filePath}: ${error}`);
      }
    }

    console.log(`  Indexed ${imageFiles.length} images`);
  }

  private async indexImageFile(filePath: string, collection: Collection): Promise<void> {
    // Check if vision model is available
    const isAvailable = await this.imageIndexer.checkAvailability();
    if (!isAvailable) {
      throw new Error(`Vision model not available. Pull it with: ollama pull ${this.imageIndexer.getModel()}`);
    }

    // Extract metadata and generate description
    const imageResult = await this.imageIndexer.indexImage(filePath);
    
    // Create content string from description
    const content = `[Image: ${path.basename(filePath)}]\n\n${imageResult.description}`;
    const normalized = normalizeContent(content);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');

    // Build metadata with image-specific fields
    const baseMetadata = buildDocumentMetadata('image', normalized);
    const metadata: DocumentMetadata = {
      ...baseMetadata,
      imageMetadata: {
        width: imageResult.metadata.width,
        height: imageResult.metadata.height,
        format: imageResult.metadata.format,
        sizeBytes: imageResult.metadata.sizeBytes,
      },
    };

    const title = this.extractImageTitle(filePath, imageResult.description);

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

  private extractImageTitle(filePath: string, description: string): string {
    // Use the first sentence or first 100 chars of description as title
    const firstSentence = description.split(/[.!?]/)[0];
    if (firstSentence && firstSentence.length <= 100) {
      return firstSentence.trim();
    }
    // Fallback to filename
    return path.basename(filePath);
  }

  private async indexTextFile(filePath: string, collection: Collection): Promise<void> {
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
    if (collection.type === 'files' || collection.type === 'image') {
      const pattern = path.join(collection.path, collection.glob || '**/*');
      return globby([pattern, '!**/node_modules/**', '!.git/**']);
    }
    return [];
  }

  private extractTitle(content: string, filePath: string): string {
    const h1Match = content.match(/^# (.+)$/m);
    if (h1Match && h1Match[1]) return h1Match[1].trim();
    return path.basename(filePath);
  }
}