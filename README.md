# search-cli

A terminal CLI search application for local notes, files, and emails with **state-of-the-art RAG** (Retrieval-Augmented Generation) capabilities.

## SOTA RAG Features

- **Hybrid Search Pipeline**:
  - BM25 lexical search with proper IDF and document length normalization
  - Vector semantic search with ANN (Approximate Nearest Neighbors) via sqlite-vec
  - Reciprocal Rank Fusion (RRF) for combining results
  - Cross-encoder reranking for improved relevance

- **Real Semantic Embeddings**:
  - Local embeddings via Xenova Transformers (MiniLM-L6-v2)
  - No API keys required - runs entirely offline
  - Per-chunk indexing with parent document tracking
  - Automatic deduplication (best chunk per document, unique paths only)

- **Metadata Filtering**:
  - JSON path-based filters
  - Date ranges, file types, tags, collections
  - Combined with search for precise results

## Additional Features

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

## Architecture

```
Query → Parallel Retrieval (BM25 + Vector ANN)
           ↓
    Chunk Deduplication (best match per document)
           ↓
    Reciprocal Rank Fusion (RRF)
           ↓
    Metadata Filtering
           ↓
    Path Deduplication (unique results only)
           ↓
    Cross-Encoder Reranking
           ↓
    Results
```

1. **BM25 Search**: Classic lexical search with term frequency and document length normalization
2. **Vector Search**: Semantic similarity using embeddings via sqlite-vec ANN (returns best chunk per document)
3. **RRF Fusion**: Combines both result sets without score normalization issues
4. **Metadata Filters**: JSON-based filtering by date, collection, file type, tags
5. **Deduplication**: Ensures unique results by path, preventing duplicate entries from multiple document IDs or chunks
6. **Reranking**: Cross-encoder (MSMARCO) scores top-k results for relevance

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

# Build the index (downloads models on first run ~50MB)
bun run src/index.ts index

# Search with full RAG pipeline
bun run src/index.ts query "your query"

# Disable reranking for faster results
bun run src/index.ts query "your query" --rerank=false

# Vector-only search
bun run src/index.ts vsearch "your query"

# Keyword-only search
bun run src/index.ts search "your query"
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize database and config |
| `add <path>` | Add a collection |
| `remove <name>` | Remove a collection |
| `list` | List all collections |
| `search <query>` | BM25 keyword search |
| `vsearch <query>` | Vector semantic search (sqlite-vec ANN) |
| `query <query>` | Full RAG pipeline (BM25 + Vector → RRF → Reranking) |
| `index` | Rebuild search index with embeddings |
| `status` | Show index statistics |
| `interactive` | Interactive search mode |
| `watch` | Watch for changes |
| `export <query>` | Export results (JSON/CSV/Markdown) |

### Query Options

```bash
# Basic RAG query
bun run src/index.ts query "machine learning"

# Limit results
bun run src/index.ts query "machine learning" --limit 5

# Disable reranking (faster)
bun run src/index.ts query "machine learning" --rerank=false

# Metadata filtering (JSON)
bun run src/index.ts query "machine learning" --filter '{"operator":"and","filters":[{"field":"collection","operator":"eq","value":"notes"}]}'
```

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
