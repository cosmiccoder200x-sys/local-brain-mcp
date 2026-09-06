[![M8ven Score](https://m8ven.ai/badge/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)](https://m8ven.ai/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

# 🧠 local-brain-mcp

> **Local-first, Git-aware persistent memory for AI coding assistants.**

Local Brain is a lightweight [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that indexes your repository's Git history and manual engineering decisions into an embedded SQLite vector database. It equips AI coding assistants (Claude Code, Cursor, GitHub Copilot, Windsurf, Zed) with long-term codebase memory—100% offline, zero egress, and zero cloud API keys.

---

## 📖 Table of Contents

| Problem with cloud AI memory tools | How local-brain solves it |
|---|---|
| 🐌 150–800ms network latency per recall | ⚡ < 5ms — local SQLite vector search |
| ☁️ Your code sent to foreign servers | 🔒 100% on-device, zero egress |
| 💸 Token bloat on every session | 📦 Hard 250-token budget cap per recall |
| 🗑️ Stale outdated context from old decisions | 🔄 Git-diff invalidation marks old memories STALE |
| 🌊 WIP/typo commits pollute the brain | 🎯 Quality filter keeps only high-signal lessons |
| 🏗️ Monorepo noise across packages | 🎯 Path-scoped queries, per-package namespacing |
| 🔁 Duplicate memories waste tokens | 🧬 Smart deduplication + merge on ingest |
| 🤷 No record of how a decision evolved | 🔍 Full memory lineage with `brain_trace` |

---

## Quick Start

```bash
# 1. Navigate to your Git repository
cd /path/to/your-project

# 2. Auto-detect installed AI editors and link MCP configuration
npx local-brain init

# 3. Ingest your Git history into the local brain database
npx local-brain ingest

# 4. Check memory database statistics
npx local-brain status

# 5. Restart your AI editor (Claude Code, Cursor, Copilot, Windsurf, Zed)
```

---

## Editor / MCP Setup

All tools carry [MCP 1.5 annotations](https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/#tool-annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can show confirmation dialogs before destructive operations.

### `brain_recall`
Semantic search your codebase memory. Results ranked by a composite score (similarity 45%, scope 20%, recency 10%, confidence 10%, importance 10%, quality 5%) and capped to 250 tokens.

```json
{
  "mcpServers": {
    "local-brain": {
      "command": "node",
      "args": ["/absolute/path/to/local-brain-mcp/dist/mcp-server.js"],
      "env": {}
    }
  }
}
```

---

## What is MCP? (For Beginners)

The **Model Context Protocol (MCP)** is an open standard created by Anthropic that allows AI applications (like Claude or Cursor) to securely interact with local tools and data sources.

```text
┌─────────────────────────┐
│   AI Coding Assistant   │
└───────────┬─────────────┘
            │ Tool Invocation (JSON-RPC over stdio)
            ▼
┌─────────────────────────┐
│     Local Brain MCP     │
└───────────┬─────────────┘
            │ Parameterized SQL
            ▼
┌─────────────────────────┐
│  Embedded SQLite DB     │
└─────────────────────────┘
```

Local Brain runs locally as a background process over standard input/output (`stdio`). The AI invokes Local Brain tools whenever it needs to recall past lessons or remember new rules.

---

## MCP Tools Reference

### 1. `brain_recall`
Semantically searches codebase memories relevant to the query and optional file scope.

- **Type**: Read-only
- **When to use**: Before refactoring, fixing bugs, or implementing features to check if relevant lessons or constraints exist.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | **Yes** | What to search for (max 1000 characters). |
| `file_path` | `string` | No | Repo-relative file path to scope the query (e.g. `src/auth/jwt.ts`). |
| `max_items` | `number` | No | Maximum memories to return (1–20, default: 5). |
| `category` | `string` | No | Filter by category: `fix`, `architecture`, `convention`, `bug`, `manual`. |

**Example Input:**
```json
{
  "query": "JWT token expiration bug",
  "file_path": "src/auth/jwt.ts",
  "max_items": 3
}
```

**Example Output:**
```markdown
## Brain Recall: "JWT token expiration bug"
• [src/auth/jwt.ts @ 8a4f12] (fix): JWT refresh race condition — RS256 cert rotates every 24h. Cache public keys with 1h TTL.
• [src/auth/session.ts @ c31d04] (bug): Sessions expire silently on Tuesday UTC maintenance window.
```

---

### `brain_learn`
Manually store a lesson or team convention with quality assessment. Low-signal content (shell noise, one-liners) is automatically filtered.

- **Type**: Write
- **When to use**: When you or the AI discover a crucial rule, edge case, or convention that is not documented in git commits.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `lesson` | `string` | **Yes** | Actionable lesson or decision (max 10000 characters). |
| `category` | `string` | No | Category: `fix`, `architecture`, `convention`, `bug`, `manual` (default: `manual`). |
| `file_path` | `string` | No | Associated file path (e.g. `src/db/connection.ts`). |
| `importance` | `number` | No | Importance multiplier between 0.5 and 2.0 (default: 1.0). |

**Example Input:**
```json
{
  "lesson": "Always use parameterized prepared statements in better-sqlite3 to prevent injection.",
  "category": "convention",
  "file_path": "src/db/queries.ts",
  "importance": 1.5
}
```

---

### `brain_trace`
Full chronological history of all memories for a specific file, including superseded and deprecated entries.

- **Type**: Read-only
- **When to use**: When investigating the maintenance history or past regressions of a specific source file.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `file_path` | `string` | **Yes** | Repo-relative file path (e.g. `src/db.ts`). |

**Example Input:**
```json
{
  "file_path": "src/db.ts"
}
```

---

### `brain_forget`
Permanently remove or deprecate a specific memory by ID (idempotent).

```json
{
  "id": 42,
  "hard_delete": false
}
```

---

### `brain_prune`
Remove stale/deprecated memories in bulk. Optionally triggers a full git-diff invalidation pass.

- **Type**: Destructive Write
- **When to use**: After major refactors or codebase rewrites to purge outdated knowledge.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | `string` | No | `stale`, `deprecated`, or `all` (default: `stale`). |
| `run_invalidation` | `boolean` | No | If true, runs a git invalidation pass first (default: `false`). |

**Example Input:**
```json
{
  "status": "stale",
  "run_invalidation": true
}
```

---

### `brain_status`
Returns health diagnostics: memory counts by status, DB size, schema version, oldest/newest entries.

```json
{}
```

---

## CLI Commands

```bash
local-brain init              # setup wizard — writes MCP config for all detected editors
local-brain ingest            # scan git history and build the brain DB
local-brain ingest --since "6 months ago" --verbose
local-brain status            # show DB memory counts and diagnostics
local-brain prune --invalidate  # detect + remove stale memories
local-brain learn "lesson text" --category convention --file src/db/client.ts
local-brain trace --file src/db/client.ts
local-brain forget --id 42
```

---

## Real-World Usage Example

```
git history
    ↓
[git-ingest.ts] — filters WIP/typo/format commits + quality assessment
    ↓ duplicate?
[db.ts] — findDuplicateMemory → smart merge (preserves richest summary)
    ↓
[embeddings.ts] — pure-JS TF-IDF feature hashing (384-dim, sub-1ms, zero network)
    ↓
[db.ts] — stores in .git/brain.db (provenance: author, branch, confidence, importance)
    ↓ (on file change)
[invalidation.ts] — marks stale if file changed > 30% (multi-file array support)
    ↓ (on MCP tool call)
[recall.ts] — cosine similarity + multi-factor ranking, scoped to package, capped to 250 tokens
    ↓
Claude Code / Cursor / Copilot / Windsurf / Zed
```

### Ranking Formula

```
rank_score = (similarity × 0.45)
           + (scope_boost × 0.20)
           + (recency × 0.10)
           + (confidence × 0.10)
           + (importance × 0.10)
           + (quality × 0.05)
           × status_multiplier   (active=1.0, stale=0.25, deprecated=0.05)
```

### Memory Lifecycle

```
inserted (active)
    → stale   (git-diff invalidation if file changed > 30%)
    → deprecated  (superseded by newer memory or manual forget)
    → deleted (hard prune)
```

---

## Schema & Provenance

Each memory stores:

| Field | Description |
|---|---|
| `content` | Raw commit message or lesson text |
| `summary` | Distilled one-liner (merged on dedup) |
| `file_path` | Canonical file(s) this memory belongs to |
| `author` | Git commit author |
| `branch` | Branch at ingest time |
| `commit_hash` | SHA of the commit |
| `confidence` | Float 0–1, updated on merge |
| `importance` | Float, boosted by quality signals |
| `status` | `active` / `stale` / `deprecated` |
| `superseded_by` | FK to the memory that replaced this one |
| `quality_score` | Float output of quality assessment |

---

## Project Structure

```text
local-brain-mcp/
├── src/
│   ├── cli.ts              # Command-line interface and setup wizard
│   ├── db.ts               # SQLite database management and migrations
│   ├── embeddings.ts       # Code-aware TF-IDF feature hashing vectorizer
│   ├── git-ingest.ts       # Commit filtering and git ingestion pipeline
│   ├── invalidation.ts     # Git-diff staleness detection engine
│   ├── mcp-server.ts       # MCP server definition and tool handlers
│   ├── recall.ts           # Multi-factor ranking and token-capped search
│   ├── schema.sql          # Core SQLite table schemas and triggers
│   └── scoping.ts          # Monorepo package scope and path sanitization
├── tests/
│   ├── mcp-tools.test.js    # MCP protocol and tool integration tests
│   ├── embeddings.test.js   # Vectorizer and cosine math unit tests
│   ├── recall-ranking.test.js # Multi-factor ranking algorithm tests
│   ├── scoping.test.js      # Monorepo scope and path security tests
│   ├── security.test.js     # SQL injection and path traversal tests
│   ├── invalidation.test.js # Diff parsing and threshold tests
│   └── git-ingest.test.js   # Commit filter regex and classifier tests
├── scripts/
│   ├── benchmark.mjs        # Performance benchmark runner
│   ├── copy-schema.mjs      # Build step copying SQL schema to dist
│   └── evaluate-retrieval.mjs # Information Retrieval evaluation runner
├── .github/workflows/ci.yml # Multi-version Node.js CI workflow
├── package.json
├── tsconfig.json
└── README.md
```

---

## Troubleshooting

### 1. MCP Server Not Appearing in AI Assistant
- Run `npx local-brain init` to re-apply editor configurations.
- Verify that your editor was completely restarted.
- Check that `node` is available in your system `PATH`.

### 2. No Memories Returned on Recall
- Ensure git history has been ingested: `npx local-brain ingest`.
- Check database status: `npx local-brain status`.
- If working in a subdirectory, check monorepo package scoping.

### 3. Memories Flagged as Stale
- If a file had substantial changes (>30% lines), its memories are automatically marked `stale`.
- Run `npx local-brain prune --invalidate` to clean outdated records and re-run `npx local-brain ingest`.

---

## Development & Testing

```bash
# Clone the repository
git clone https://github.com/cosmiccoder200x-sys/local-brain-mcp.git
cd local-brain-mcp

# Install dependencies
npm install

# Type check
npm run typecheck

# Build TypeScript to dist/
npm run build

# Run unit and integration tests
npm test

# Run performance benchmarks
npm run benchmark

# Run retrieval quality evaluation
npm run eval
```

---

## FAQ

**Q: Does Local Brain send code to the cloud?**  
A: No. Local Brain is 100% offline and makes zero external network requests.

**Q: Do I need an OpenAI or Anthropic API key to run it?**  
A: No. Local Brain uses a built-in pure-JavaScript feature-hashing embedding engine.

**Q: Where is the memory database saved?**  
A: In `<your-repo>/.git/brain.db` (or `~/.config/local-brain/brain.db` outside git repos).

**Q: Does it work with monorepos?**  
A: Yes. Local Brain auto-detects package boundaries (e.g. `packages/auth`, `apps/web`) and scopes recalls accordingly.

---

## Tech Stack

- **Protocol:** `@modelcontextprotocol/sdk` (StdioServerTransport)
- **Storage:** `better-sqlite3` (SQLite WAL mode, BLOB float32 vectors)
- **Embeddings:** Pure-JS TF-IDF feature hashing (384-dim, sub-1ms, 100% offline)
- **Git Engine:** `simple-git`
- **CLI Engine:** `commander`

---

## Test Coverage

| Suite | Tests | Status |
|---|---|---|
| MCP Tool Annotations | 8 | ✅ pass |
| Database & Migrations | 4 | ✅ pass |
| Deduplication & Smart Merge | 4 | ✅ pass |
| Quality Assessment | 3 | ✅ pass |
| Memory Supersession | 2 | ✅ pass |
| MCP Server Lifecycle (integration) | 7 | ✅ pass |
| Adversarial Retrieval (18 cases A–R) | 18 | ✅ pass |

```bash
npm test   # runs all suites
```

---

## License

MIT — build freely.
