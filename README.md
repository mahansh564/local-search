# local-search

A terminal CLI search application for local notes, files, and emails with **state-of-the-art RAG** (Retrieval-Augmented Generation) capabilities.

## SOTA RAG Features

- **Hybrid Search Pipeline**:
  - BM25 lexical search with proper IDF and document length normalization
  - Vector semantic search with ANN (Approximate Nearest Neighbors) via sqlite-vec
  - **Score Normalization** before RRF fusion for fair combination
  - Reciprocal Rank Fusion (RRF) for combining results
  - Cross-encoder reranking for improved relevance

- **Advanced Retrieval**:
  - **MMR (Maximal Marginal Relevance)**: Balances relevance with diversity to avoid redundant results from same document
  - **Query Expansion**: Automatic synonym expansion for better recall
  - **Parent Document Retrieval**: Returns matched chunks alongside full document context

- **Smart Chunking**:
  - **Semantic chunking** that respects document structure (headers, paragraphs)
  - Preserves context across chunk boundaries
  - Overlap-based continuity between chunks

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
Query → Optional Query Expansion (synonyms)
           ↓
     Parallel Retrieval (BM25 + Vector ANN)
           ↓
     Optional MMR (diversity-aware selection)
           ↓
     Score Normalization (min-max/rank)
           ↓
     Reciprocal Rank Fusion (RRF)
           ↓
     Metadata Filtering
           ↓
     Path Deduplication (unique results only)
           ↓
     Parent Document Fetching (optional full content)
           ↓
     Cross-Encoder Reranking
           ↓
     Results
```

1. **Query Expansion**: Expands query with synonyms for better recall
2. **BM25 Search**: Classic lexical search with term frequency and document length normalization
3. **Vector Search**: Semantic similarity using embeddings via sqlite-vec ANN (returns best chunk per document)
4. **MMR**: Maximal Marginal Relevance balances relevance vs diversity (configurable via `mmrLambda`)
5. **Score Normalization**: Normalizes BM25 and vector scores to [0,1] range before fusion
6. **RRF Fusion**: Combines both result sets using rank-based fusion
7. **Metadata Filters**: JSON-based filtering by date, collection, file type, tags
8. **Deduplication**: Ensures unique results by path, preventing duplicate entries from multiple document IDs or chunks
9. **Parent Documents**: Optionally returns full document content alongside matched chunks
10. **Reranking**: Cross-encoder (MSMARCO) scores top-k results for relevance

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
| `ask <question>` | Ask questions about indexed documents (requires Ollama) |

### Ask Command (Q&A)

The `ask` command uses a local LLM (Ollama) to answer questions about your indexed documents.

**Prerequisites:**
- [Install Ollama](https://github.com/ollama/ollama)
- Pull a model: `ollama pull llama3.1` (or another model)

```bash
# Ask a question about your documents
bun run src/index.ts ask "what is this project about?"

# Use a different model
bun run src/index.ts ask "what is this project about?" --model mistral

# Disable streaming for cleaner output
bun run src/index.ts ask "what is this project about?" --no-stream

# Limit number of documents used as context
bun run src/index.ts ask "what is this project about?" --limit 3
```

**Environment Variables:**
- `OLLAMA_HOST` - Ollama server URL (default: http://localhost:11434)
- `OLLAMA_MODEL` - Default model to use (default: llama3.1)

### Query Options

```bash
# Basic RAG query
bun run src/index.ts query "machine learning"

# Limit results
bun run src/index.ts query "machine learning" --limit 5

# Disable reranking (faster)
bun run src/index.ts query "machine learning" --rerank=false

# Enable MMR for diverse results (balances relevance with diversity)
bun run src/index.ts query "machine learning" --mmr

# Set MMR lambda (0 = max diversity, 1 = max relevance, default 0.5)
bun run src/index.ts query "machine learning" --mmr-lambda=0.3

# Enable query expansion (adds synonyms for better recall)
bun run src/index.ts query "machine learning" --expand

# Include full document content in results
bun run src/index.ts query "machine learning" --full

# Combine multiple options
bun run src/index.ts query "machine learning" --mmr --expand --limit=10

# Metadata filtering (JSON)
bun run src/index.ts query "machine learning" --filter '{"operator":"and","filters":[{"field":"collection","operator":"eq","value":"notes"}]}'
```

### Programmatic Usage

```typescript
import { RAGPipeline } from './search/pipeline.js';

const pipeline = new RAGPipeline(db, {
  enableReranking: true,
  enableMMR: true,
  mmrLambda: 0.5,
  enableQueryExpansion: true,
});

const results = await pipeline.search("machine learning", {
  limit: 10,
  enableMMR: true,
  includeFullDocument: true,
  enableQueryExpansion: true,
});
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
