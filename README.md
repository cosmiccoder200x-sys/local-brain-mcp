# 🧠 local-brain-mcp

> **Local-first, zero-latency, git-aware AI memory for Claude Code, Cursor, Copilot & Windsurf.**

No cloud. No API keys. No privacy risk. Sub-5ms recall.

---

## Why local-brain?

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
# 1. Install
npm install -g local-brain-mcp

# 2. Init — auto-detects Claude Code, Cursor, Copilot, Windsurf
npx local-brain init

# 3. Ingest your git history
cd /path/to/your-project
npx local-brain ingest

# 4. Restart your AI editor — the MCP tools are now available
```

---

## MCP Tools

All tools carry [MCP 1.5 annotations](https://spec.modelcontextprotocol.io/specification/2025-03-26/server/tools/#tool-annotations) (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so hosts can show confirmation dialogs before destructive operations.

### `brain_recall`
Semantic search your codebase memory. Results ranked by a composite score (similarity 45%, scope 20%, recency 10%, confidence 10%, importance 10%, quality 5%) and capped to 250 tokens.

```json
{
  "query": "JWT auth bug",
  "file_path": "src/auth/jwt.ts",
  "max_items": 5,
  "category": "fix"
}
```

**Example output:**
```
## Brain Recall: "JWT auth bug"
• [src/auth/jwt.ts @ 8a4f12] (fix): JWT refresh race condition — RS256 cert rotates every 24h. Never use HS256 in dev.
• [src/auth/session.ts @ c31d04] (bug): Sessions expire silently on Tuesdays 02:00 UTC — auth service maintenance window.
```

---

### `brain_learn`
Manually store a lesson or team convention with quality assessment. Low-signal content (shell noise, one-liners) is automatically filtered.

```json
{
  "lesson": "Always seed the test DB before running Playwright tests or auth flows break.",
  "category": "convention",
  "file_path": "tests/setup.ts"
}
```

---

### `brain_trace`
Full chronological history of all memories for a specific file, including superseded and deprecated entries.

```json
{
  "file_path": "src/db/client.ts"
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

## How It Works

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

## Supported Editors

| Editor | Config auto-detected |
|---|---|
| Claude Code | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code Copilot | `~/.vscode/mcp.json` |
| Zed | `~/.config/zed/settings.json` |

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
