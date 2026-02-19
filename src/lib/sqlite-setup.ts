import { Database } from 'bun:sqlite';

if (process.platform === 'darwin') {
  const homebrewSqlite = '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib';
  const intelSqlite = '/usr/local/opt/sqlite/lib/libsqlite3.dylib';
  
  try {
    Database.setCustomSQLite(homebrewSqlite);
  } catch {
    try {
      Database.setCustomSQLite(intelSqlite);
    } catch {
      console.warn('Warning: Could not set custom SQLite. Install sqlite via Homebrew: brew install sqlite');
    }
  }
}

export const SQLITE_READY = true;
