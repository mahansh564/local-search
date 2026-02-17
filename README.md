# search-cli

A terminal CLI search application for local notes, files, and emails with SOTA RAG (Retrieval-Augmented Generation) capabilities.

## Features

- **Multiple Search Modes**:
  - FTS5 keyword search (fast)
  - Vector semantic search
  - Hybrid search with RRF ranking

- **Email Support**:
  - Maildir format
  - mbox format
  - Individual .eml files
  - Header extraction (From, To, Subject, Date)

- **Apple Notes Support** (macOS only):
  - Reads directly from Notes.app database
  - Supports legacy format (Notes.db) and modern format (NotesV7.storedata, NoteStore.sqlite)
  - Supports multiple database locations
  - Extracts note content with timestamps

- **Document Indexing**:
  - Markdown files
  - Plain text
  - HTML (basic)
  - Smart chunking with overlap

- **Performance**:
  - Bun-native SQLite
  - Incremental indexing
  - Hash-based deduplication

- **Interactive Features**:
  - Interactive search mode
  - File watching with auto-reindex
  - Export results (JSON, CSV, Markdown)

## Quick Start

```bash
# Initialize the search database
bun run src/index.ts init

# Add a file collection
bun run src/index.ts add ~/Documents/Notes --name notes

# Add an email collection
bun run src/index.ts add ~/Mail --name emails --type email

# Add Apple Notes collection (macOS only)
# Note: Requires Full Disk Access permission in System Settings > Privacy & Security
bun run src/index.ts add apple-notes --name apple-notes --type apple-notes

# Or specify a custom Notes database path
bun run src/index.ts add apple-notes --name apple-notes --type apple-notes --notes-db /path/to/Notes.db

# Build the index
bun run src/index.ts index

# Search
bun run src/index.ts search "your query"
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize database and config |
| `add <path>` | Add a collection |
| `remove <name>` | Remove a collection |
| `list` | List all collections |
| `search <query>` | FTS5 keyword search |
| `vsearch <query>` | Vector semantic search |
| `query <query>` | Hybrid search (FTS5 + Vector) |
| `index` | Rebuild search index |
| `status` | Show index statistics |
| `interactive` | Interactive search mode |
| `watch` | Watch for changes |
| `export <query>` | Export results |

## Troubleshooting

### Apple Notes "database not found" error

If you get this error on macOS, it's likely a permissions issue:

1. **Grant Full Disk Access** (Recommended):
   - Open System Settings > Privacy & Security > Full Disk Access
   - Add your Terminal app (e.g., Terminal.app, iTerm.app, or your IDE)
   - Restart your terminal

2. **Use sudo** (Temporary):
   ```bash
   sudo bun run src/index.ts add apple-notes --name apple-notes --type apple-notes
   ```

3. **Specify custom path**:
   ```bash
   bun run src/index.ts add apple-notes --name apple-notes --type apple-notes --notes-db ~/Library/Containers/com.apple.Notes/Data/Library/Notes/Notes.db
   # Or for macOS Sonoma+:
   bun run src/index.ts add apple-notes --name apple-notes --type apple-notes --notes-db ~/Library/Containers/com.apple.Notes/Data/Library/Notes/NotesV7.storedata
   ```

### Apple Notes "0 notes indexed" warning

If you see this message, the database was found but contains no notes. Make sure you have created at least one note in the Notes.app.

## License

MIT
