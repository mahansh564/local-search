import '../lib/sqlite-setup.js';
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
      path.join(os.homedir(), 'Library', 'Group Containers', 'group.com.apple.notes', 'NoteStore.sqlite'),
      path.join(os.homedir(), 'Library', 'Containers', 'com.apple.Notes', 'Data', 'Library', 'Notes', 'NotesV7.storedata'),
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
        // Try AppleScript first for full note content, fall back to SQLite
        const appleScriptNotes = this.indexNoteStoreFormatAppleScript(db);
        if (appleScriptNotes.length > 0) {
          notes.push(...appleScriptNotes);
        } else {
          notes.push(...this.indexNoteStoreFormatSQLite(db));
        }
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

  private indexNoteStoreFormatAppleScript(db: Database): AppleNote[] {
    console.log('  Using AppleScript to fetch full note content...');
    
    const notes: AppleNote[] = [];
    
    const startTime = Date.now();
    
    // Use simpler output format - pipe-delimited with newlines
    const script = `
      use framework "Foundation"
      use scripting additions
      
      set outputLines to {}
      tell application "Notes"
        repeat with n in every note
          set noteId to id of n
          set noteTitle to name of n
          set noteBody to plaintext of n
          -- Replace newlines and pipes in content to avoid parsing issues
          set bodyCleaned to do shell script "echo " & quoted form of noteBody & " | tr '\n' '¬' | tr '|' '§'"
          set lineContent to noteId & "|" & noteTitle & "|" & bodyCleaned
          set end of outputLines to lineContent
        end repeat
      end tell
      
      -- Join with newlines using AppleScript's text item delimiters
      set AppleScript's text item delimiters to "\n"
      set output to outputLines as text
      set AppleScript's text item delimiters to ""
      return output
    `;

    try {
      const { execSync } = require('child_process');
      
      // Write script to temp file to avoid shell escaping issues
      const tmpDir = os.tmpdir();
      const scriptPath = path.join(tmpDir, `notes_${Date.now()}.applescript`);
      fs.writeFileSync(scriptPath, script);
      
      const output = execSync(`osascript "${scriptPath}"`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300000
      });
      
      // Clean up temp file
      fs.unlinkSync(scriptPath);

      // Parse pipe-delimited output: id|title|content
      const rawOutput = output.trim();
      const lines = rawOutput.split('\n').filter(line => line.includes('|'));
      console.log(`  Found ${lines.length} notes, processing...`);
      
      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length < 3) continue;
        
        const noteId = parts[0];
        const title = parts[1] || 'Untitled';
        let content = parts.slice(2).join('|'); // Join back in case content had pipes
        
        // Restore newlines and pipes from escape sequences
        content = content.replace(/¬/g, '\n').replace(/§/g, '|');
        
        if (content.trim() || title !== 'Untitled') {
          notes.push({
            id: notes.length + 1,
            title: title,
            content: content,
            created: new Date(),
            modified: new Date(),
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Fetched ${notes.length} notes in ${elapsed}s`);
      
    } catch (error) {
      console.warn(`  AppleScript JSON failed: ${error}, falling back to SQLite...`);
      return this.indexNoteStoreFormatSQLite(db);
    }
    
    return notes;
  }

  private indexNoteStoreFormatSQLite(db: Database): AppleNote[] {
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
