[![M8ven Score](https://m8ven.ai/badge/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)](https://m8ven.ai/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)
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
| 🌊 WIP/typo commits pollute the brain | 🎯 Conventional commit filter keeps only high-signal lessons |
| 🏗️ Monorepo noise across packages | 🎯 Path-scoped queries, per-package namespacing |

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

### `brain_recall`
Semantic search your codebase memory. Results capped to 250 tokens.

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
Manually store a lesson or team convention.

```json
{
  "lesson": "Always seed the test DB before running Playwright tests or auth flows break.",
  "category": "convention",
  "file_path": "tests/setup.ts"
}
```

---

### `brain_trace`
Full history of all memories for a specific file.

```json
{
  "file_path": "src/db/client.ts"
}
```

---

### `brain_prune`
Remove stale/deprecated memories. Optionally run the full git invalidation pass.

```json
{
  "status": "stale",
  "run_invalidation": true
}
```

---

## CLI Commands

```bash
local-brain init              # setup wizard — writes MCP config for all detected editors
local-brain ingest            # scan git history and build the brain DB
local-brain ingest --since "6 months ago" --verbose
local-brain status            # show DB memory counts
local-brain prune --invalidate  # detect + remove stale memories
```

---

## How It Works

```
git history
    ↓
[git-ingest.ts] — filters WIP/typo/format commits
    ↓
[embeddings.ts] — pure-JS TF-IDF feature hashing (sub-1ms, zero network)
    ↓
[db.ts] — stores in .git/brain.db (Float32Array BLOB vectors in SQLite)
    ↓ (on file change)
[invalidation.ts] — marks stale if file changed > 30%
    ↓ (on MCP tool call)
[recall.ts] — in-memory cosine similarity search, scoped to package, capped to 250 tokens
    ↓
Claude Code / Cursor / Copilot / Windsurf / Zed
```

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
- **Storage:** `better-sqlite3` (SQLite WAL mode with BLOB vectors)
- **Embeddings:** Pure-JS TF-IDF feature hashing (384-dim, sub-1ms, 100% offline)
- **Git Engine:** `simple-git`
- **CLI Engine:** `commander`

---

## License

MIT — build freely.
[![M8ven Score](https://m8ven.ai/badge/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)](https://m8ven.ai/mcp/cosmiccoder200x-sys-local-brain-mcp-1eus5c)

