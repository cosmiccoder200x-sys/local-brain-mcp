[![M8ven Score](https://m8ven.ai/badge/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)](https://m8ven.ai/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

# 🧠 local-brain-mcp

> **Local-first, Git-aware persistent memory for AI coding assistants.**

Local Brain is a lightweight [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that indexes your repository's Git history and manual engineering decisions into an embedded SQLite vector database. It equips AI coding assistants (Claude Code, Cursor, GitHub Copilot, Windsurf, Zed) with long-term codebase memory—100% offline, zero egress, and zero cloud API keys.

---

## 📖 Table of Contents

- [What is Local Brain?](#what-is-local-brain)
- [Why Local Brain?](#why-local-brain)
- [How It Works](#how-it-works)
- [Memory Lifecycle](#memory-lifecycle)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Editor / MCP Setup](#editor--mcp-setup)
- [What is MCP? (For Beginners)](#what-is-mcp-for-beginners)
- [MCP Tools Reference](#mcp-tools-reference)
  - [brain_recall](#1-brain_recall)
  - [brain_learn](#2-brain_learn)
  - [brain_trace](#3-brain_trace)
  - [brain_prune](#4-brain_prune)
  - [brain_status](#5-brain_status)
  - [brain_forget](#6-brain_forget)
- [MCP Tool Summary](#mcp-tool-summary)
- [CLI Reference](#cli-reference)
- [Real-World Usage Example](#real-world-usage-example)
- [Data Storage](#data-storage)
- [Privacy and Security](#privacy-and-security)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Development & Testing](#development--testing)
- [FAQ](#faq)
- [Tech Stack](#tech-stack)
- [Contributing](#contributing)
- [License](#license)

---

## What is Local Brain?

AI coding assistants frequently suffer from context amnesia. In every new conversation, the AI forgets past bug fixes, architectural constraints, breaking schema changes, and team conventions.

**Local Brain solves this by transforming your repository's Git history and developer lessons into an indexed memory engine.**

```text
Your Code + Git History
          ↓
     Local Brain (Ingestion & Filters)
          ↓
  SQLite Memory Database (.git/brain.db)
          ↓
  Multi-Factor Semantic Retrieval
          ↓
   AI Assistant via MCP Protocol
          ↓
 Context-Aware, Accurate Engineering
```

When you ask your AI assistant to solve an issue, it automatically queries Local Brain for historical context, past regressions, and architectural rules relevant to the files you are editing.

---

## Why Local Brain?

| Dimension | Cloud AI Memory Tools | Local Brain MCP |
|---|---|---|
| **Data Storage** | Remote 3rd-party servers | 100% local on-device SQLite database |
| **Network Dependency** | Required for every query | Zero network calls; 100% offline |
| **API Keys** | OpenAI / Cloud API keys required | Zero API keys required |
| **Git Awareness** | Blind to git history & diffs | Automatically parses commits, diffs & branches |
| **Stale Memory Handling** | Memories persist indefinitely | Git-diff invalidation auto-detects stale context |
| **Monorepo Scoping** | Global cross-package noise | Scoped to sub-packages (`packages/auth`, `apps/web`) |
| **Token Consumption** | Large dumps consuming context window | Hard 250-token budget cap per recall |
| **Retrieval Speed** | Network roundtrips (150–800ms) | In-memory SQLite vector search (< 1ms) |

---

## How It Works

```text
┌─────────────────────────────────────────────────────────────┐
│                      Git Ingestion                          │
│  Scans repository commits → Filters high-signal commits    │
│  (fixes, feats, breaking changes, reverts, issue closes)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Feature Hashing Engine                    │
│  Code-aware tokenization + Stopword filter + Sublinear TF   │
│  Generates deterministic 384-dim Float32Array vector        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   SQLite Embedded DB                        │
│  Stores memories with BLOB vector embeddings in WAL mode    │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│       Git Invalidation      │ │    Multi-Factor Recall      │
│  Detects >30% line changes  │ │  Similarity 60% + Imp 15%   │
│  since commit → Marks STALE │ │  + Freshness 15% + Conf 10% │
└─────────────────────────────┘ └──────────────┬──────────────┘
                                               │
                                               ▼
                                ┌─────────────────────────────┐
                                │   AI Assistant via MCP      │
                                └─────────────────────────────┘
```

### 1. High-Signal Commit Filtering
During ingestion, commits matching noise patterns (`wip`, `temp`, `typo`, `format:`, `lint:`, `bump version`, `[skip ci]`) are skipped. Only high-signal commits (`fix:`, `feat:`, `refactor:`, `perf:`, `revert:`, `BREAKING CHANGE`, PR merges, issue resolutions) are indexed.

### 2. Category & Importance Inference
Commits and lessons are categorized into `fix`, `architecture`, `convention`, `bug`, or `manual`. Breaking architectural changes and security fixes receive an importance boost.

### 3. Pure-JS Feature Hashing Embeddings
Texts are processed by a code-aware tokenizer that splits identifiers (`jwtToken` → `jwt`, `token`) and strips stopwords. Features are projected into a 384-dimensional unit vector using sublinear BM25-style term weighting ($tf / (tf + 1.2)$).

### 4. Transparent Multi-Factor Ranking
Search queries rank candidate memories using a composite scoring formula:
$$\text{Score} = (0.60 \times \text{SemanticSimilarity}) + (0.15 \times \text{Importance}) + (0.15 \times \text{Freshness}) + (0.10 \times \text{Confidence})$$
Freshness decays smoothly with an exponential 120-day half-life so recent context is prioritized while vital architecture decisions remain discoverable.

### 5. Automated Git Invalidation
When files are modified by more than 30% lines of code relative to when a memory was stored, Local Brain automatically flags that memory as `stale`.

---

## Memory Lifecycle

```text
  [ git-ingest / brain_learn ]
                │
                ▼
        ┌───────────────┐
        │    ACTIVE     │ ──► Returned in semantic recalls
        └───────┬───────┘
                │ File modified > 30% (git invalidation)
                ▼
        ┌───────────────┐
        │     STALE     │ ──► Excluded from recall; visible in trace
        └───────┬───────┘
                │
                ├──────────────────────────────┐
                ▼                              ▼
        ┌───────────────┐              ┌───────────────┐
        │  DEPRECATED   │              │    PRUNED     │
        │ (Manual flag) │              │ (Removed DB)  │
        └───────────────┘              └───────────────┘
```

- **`active`**: Current, valid memories returned by semantic recall.
- **`stale`**: Automatically marked when associated file contents changed significantly.
- **`deprecated`**: Manually flagged as superseded.

---

## Installation

### Global Installation (Recommended)
```bash
npm install -g local-brain-mcp
```

### Requirements
- **Node.js**: `>= 18.0.0`
- **Git**: `>= 2.30.0`

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

`local-brain init` automatically detects and configures the following editors:

| Editor | Configuration File |
|---|---|
| **Claude Code** | `~/.claude.json` |
| **Cursor** | `~/.cursor/mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code Copilot** | `~/.vscode/mcp.json` |
| **Zed** | `~/.config/zed/settings.json` |

### Manual MCP Configuration
If your editor is not auto-detected, add the following entry to your editor's MCP server configuration file:

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

### 2. `brain_learn`
Stores a new manual lesson, rule, or architectural decision.

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

### 3. `brain_trace`
Retrieves all memory history for a specific file in chronological order.

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

### 4. `brain_prune`
Cleans up stale or deprecated memories.

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

### 5. `brain_status`
Returns safe operational telemetry, Git HEAD status, and database metrics.

- **Type**: Read-only
- **When to use**: Diagnostics and verifying that Local Brain is active.

**Example Output:**
```text
## 🧠 Local Brain Status
• Server Version:    v1.1.0
• Total Memories:    142
  - Active:          138
  - Stale:           4
  - Deprecated:      0
  - Git Ingested:    129
  - Manual Lessons:  13
• Commits Ingested:  87
• Database Size:     48.0 KB
• Git Branch:        main (@ a1b2c3d)
• Embedding Engine:  384-dim code-aware TF-IDF feature hashing (100% offline)
• Ranking:           Multi-factor (Similarity 60%, Importance 15%, Freshness 15%, Confidence 10%)
```

---

### 6. `brain_forget`
Permanently deletes a specific memory by its integer ID.

- **Type**: Destructive Write
- **When to use**: When an incorrect or sensitive memory needs to be purged.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `memory_id` | `number` | **Yes** | The positive integer ID of the memory to remove. |

**Example Input:**
```json
{
  "memory_id": 42
}
```

---

## MCP Tool Summary

| Tool Name | Purpose | Read/Write | Destructive | Idempotent |
|---|---|---|---|---|
| **`brain_recall`** | Semantic query across codebase memory | Read | No | Yes |
| **`brain_learn`** | Store a new lesson or convention | Write | No | No |
| **`brain_trace`** | Full memory history for a file | Read | No | Yes |
| **`brain_prune`** | Clean up stale/deprecated records | Write | **Yes** | Yes |
| **`brain_status`** | Operational statistics and telemetry | Read | No | Yes |
| **`brain_forget`** | Delete a specific memory by ID | Write | **Yes** | Yes |

---

## CLI Reference

`local-brain` provides a command-line interface for maintenance and diagnostics:

```bash
# 1. Setup wizard
local-brain init [--repo <path>] [--no-hook]

# 2. Ingest git history
local-brain ingest [--repo <path>] [--since <date>] [--commits <n>] [--verbose] [--quiet]

# 3. Test recall directly from terminal
local-brain query <text> [--repo <path>] [--file <path>]

# 4. Manually learn a lesson via CLI
local-brain learn "<lesson>" [--category <cat>] [--file <path>]

# 5. System diagnostics
local-brain doctor

# 6. Database statistics
local-brain status [--repo <path>]

# 7. Prune stale records
local-brain prune [--status <stale|deprecated|all>] [--invalidate]

# 8. Delete memory by ID
local-brain forget <id>
```

---

## Real-World Usage Example

1. **Bug Encountered**: A developer asks the AI: *"Why is the user session expiring immediately after login?"*
2. **AI Recalls Past Context**: The AI calls `brain_recall(query: "session expiration immediately after login", file_path: "src/auth/session.ts")`.
3. **Local Brain Responds**:
   ```
   • [src/auth/session.ts @ f41a9b] (fix): Redis session TTL was in milliseconds instead of seconds.
   ```
4. **AI Applies Fix**: The AI uses this context to verify the TTL configuration and fixes the bug immediately.
5. **Developer Records New Lesson**: The developer asks the AI to save the lesson, calling `brain_learn`.

---

## Data Storage

Local Brain stores data in an embedded SQLite database using write-ahead logging (WAL):

1. **Repository-Scoped (Default)**: `<repo-root>/.git/brain.db`
2. **Global Fallback**: `~/.config/local-brain/brain.db`

### Schema Overview:
- `memories`: ID, category, content, summary, file_path, package_scope, commit_hash, git_ref, status, source, token_count, importance, confidence, embedding (BLOB), created_at, updated_at.
- `file_snapshots`: file_path, commit_hash, line_count, updated_at.
- `ingested_commits`: commit_hash, memory_count, ingested_at.

---

## Privacy and Security

- **100% Local**: All vector embeddings and database records reside strictly on your local machine.
- **Zero Network Egress**: The MCP server makes no outbound HTTP/HTTPS requests.
- **No API Keys**: The feature-hashing embedding engine runs purely in TypeScript/JavaScript without external services.
- **Path Sanitization**: All file paths are sanitized to prevent directory traversal (`../`).
- **Parameterized SQL**: All database operations use parameterized statements to prevent SQL injection.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    AI Coding Assistant                      │
│            Claude Code / Cursor / Windsurf / Zed            │
└──────────────────────────────┬──────────────────────────────┘
                               │ Model Context Protocol (stdio)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       MCP Server                            │
│  brain_recall | brain_learn | brain_trace | brain_status    │
│  brain_prune  | brain_forget                                │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│   Multi-Factor Ranking      │ │      Git Ingestion          │
│   Semantic Sim (60%)        │ │      Smart Commit Filter    │
│   Importance   (15%)        │ │      Category Inference     │
│   Freshness    (15%)        │ └──────────────┬──────────────┘
│   Confidence   (10%)        │                │
└──────────────┬──────────────┘                │
               │                               │
               ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                Feature Hashing Embeddings                   │
│   384-dim code-aware tokenizer, BM25 TF-IDF, L2 unit norm   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                SQLite Storage (better-sqlite3)              │
│                WAL Mode + BLOB Vector Indices               │
└─────────────────────────────────────────────────────────────┘
```

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

- **Protocol**: `@modelcontextprotocol/sdk` (StdioServerTransport)
- **Database**: `better-sqlite3` (SQLite with WAL mode and BLOB vectors)
- **Vector Engine**: Pure-JS 384-dimensional code-aware feature hashing
- **Git Engine**: `simple-git`
- **CLI Engine**: `commander`
- **Language**: TypeScript (ES2022 / NodeNext)

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting a pull request.

---

## License

[MIT](LICENSE) © cosmiccoder200x-sys
