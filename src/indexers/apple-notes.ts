import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface AppleNote {
  id: number;
  title: string;
  content: string;
  created: Date;
  modified: Date;
}

export class AppleNotesIndexer {
  private dbPath: string;

  constructor(customPath?: string) {
    this.dbPath = customPath || this.findNotesDatabase();
  }

  private findNotesDatabase(): string {
    const possiblePaths = [
      // Modern CoreData format (macOS Sonoma+) - where actual notes are stored
      path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.notes', 'NoteStore.sqlite'),
      // Container format
      path.join(os.homedir(), 'Library', 'Containers', 'com.apple.Notes', 'Data', 'Library', 'Notes', 'NotesV7.storedata'),
      // Legacy SQLite format
      path.join(os.homedir(), 'Library', 'Notes', 'Notes.db'),
      path.join(os.homedir(), 'Library', 'Containers', 'com.apple.Notes', 'Data', 'Library', 'Notes', 'Notes.db'),
      path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.notes', 'Notes.db'),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return possiblePaths[0] ?? '';
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath);
  }

  getNotesPath(): string {
    return this.dbPath;
  }

  indexNotes(): AppleNote[] {
    if (!this.isAvailable()) {
      throw new Error(`Apple Notes database not found at ${this.dbPath}`);
    }

    const db = new Database(this.dbPath, { readonly: true });

    const notes: AppleNote[] = [];

    try {
      if (this.isNoteStoreFormat(db)) {
        notes.push(...this.indexNoteStoreFormat(db));
      } else if (this.isModernFormat(db)) {
        notes.push(...this.indexModernFormat(db));
      } else {
        notes.push(...this.indexLegacyFormat(db));
      }
      
      if (notes.length === 0) {
        console.warn('  No notes found in Apple Notes database');
        console.warn('  Try creating a note in the Notes.app first');
      }
    } catch (error) {
      console.warn(`Failed to read Apple Notes: ${error}`);
    } finally {
      db.close();
    }

    return notes;
  }

  private isModernFormat(db: Database): boolean {
    try {
      db.query("SELECT 1 FROM ZNOTEBODY LIMIT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  private isNoteStoreFormat(db: Database): boolean {
    try {
      db.query("SELECT 1 FROM ZICCLOUDSYNCINGOBJECT LIMIT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  private indexNoteStoreFormat(db: Database): AppleNote[] {
    const notes: AppleNote[] = [];
    
    const results = db.query(`
      SELECT 
        Z_PK as id,
        ZTITLE as title,
        ZSNIPPET as content,
        ZCREATIONDATE as created,
        ZMODIFICATIONDATE as modified,
        ZIDENTIFIER as identifier
      FROM ZICCLOUDSYNCINGOBJECT
      WHERE Z_ENT = 11
      ORDER BY ZMODIFICATIONDATE DESC
    `).all() as Array<{
      id: number;
      title: string;
      content: string;
      created: number;
      modified: number;
      identifier: string;
    }>;

    for (const row of results) {
      const content = row.content || '';
      const title = row.title || content.substring(0, 50) || 'Untitled';
      
      if (content.trim() || title !== 'Untitled') {
        notes.push({
          id: row.id,
          title: title,
          content: content,
          created: this.convertAppleDate(row.created),
          modified: this.convertAppleDate(row.modified),
        });
      }
    }
    
    return notes;
  }

  private indexModernFormat(db: Database): AppleNote[] {
    const notes: AppleNote[] = [];
    
    const results = db.query(`
      SELECT 
        n.Z_PK as id,
        n.ZTITLE as title,
        nb.ZHTMLSTRING as content,
        n.ZDATECREATED as created,
        n.ZDATEEDITED as modified
      FROM ZNOTE n
      LEFT JOIN ZNOTEBODY nb ON n.ZBODY = nb.Z_PK
      WHERE n.ZTITLE IS NOT NULL
      ORDER BY n.ZDATEEDITED DESC
    `).all() as Array<{
      id: number;
      title: string;
      content: string;
      created: number;
      modified: number;
    }>;

    for (const row of results) {
      const content = this.extractPlainText(row.content);
      
      if (content.trim() || row.title) {
        notes.push({
          id: row.id,
          title: row.title || 'Untitled',
          content: content,
          created: this.convertAppleDate(row.created),
          modified: this.convertAppleDate(row.modified),
        });
      }
    }
    
    return notes;
  }

  private indexLegacyFormat(db: Database): AppleNote[] {
    const notes: AppleNote[] = [];
    
    const results = db.query(`
      SELECT 
        Z_PK as id,
        ZTITLE as title,
        ZCONTENT as content,
        ZCREATIONDATE as created,
        ZMODIFICATIONDATE as modified
      FROM ZNOTE
      WHERE ZTITLE IS NOT NULL
      ORDER BY ZMODIFICATIONDATE DESC
    `).all() as Array<{
      id: number;
      title: string;
      content: string;
      created: number;
      modified: number;
    }>;

    for (const row of results) {
      const content = this.extractPlainText(row.content);
      
      if (content.trim()) {
        notes.push({
          id: row.id,
          title: row.title || 'Untitled',
          content: content,
          created: this.convertAppleDate(row.created),
          modified: this.convertAppleDate(row.modified),
        });
      }
    }
    
    return notes;
  }

  private extractPlainText(html: string): string {
    if (!html) return '';

    let text = html;
    
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n');
    text = text.replace(/<li[^>]*>/gi, '\n• ');
    text = text.replace(/<\/li>/gi, '');
    
    text = text.replace(/<[^>]+>/g, '');
    
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text.trim();
  }

  private convertAppleDate(timestamp: number): Date {
    if (!timestamp) return new Date();
    return new Date((timestamp + 978307200) * 1000);
  }
}
