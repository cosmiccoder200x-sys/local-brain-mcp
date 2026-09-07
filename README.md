[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/website-live-06B6D4.svg)](https://local-brain-mcp.vercel.app/)
[![CI](https://github.com/cosmiccoder200x-sys/local-brain-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/cosmiccoder200x-sys/local-brain-mcp/actions)
[![npm version](https://img.shields.io/npm/v/local-brain-mcp.svg)](https://www.npmjs.com/package/local-brain-mcp)
[![npm downloads](https://img.shields.io/npm/dm/local-brain-mcp.svg)](https://www.npmjs.com/package/local-brain-mcp)

<h1 align="center">Local Brain MCP</h1>
<p align="center"><b>Persistent, local-first shared memory for AI coding agents.</b></p>

<p align="center">
  <a href="https://local-brain-mcp.vercel.app/">Official Website</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#mcp-tools-reference-7-tools">MCP Tools</a> •
  <a href="#multi-agent-architecture">Multi-Agent</a>
</p>

---

> **Shared, local-first memory for AI coding agents.**

Local Brain is a Model Context Protocol (MCP) server that indexes your repository's Git history and engineering decisions into an embedded SQLite vector database. Every recall runs in ~3 ms (p50, local benchmark). No network calls. No cloud dependencies.

```
Claude Code ─┐
Cursor      ─┼── Local Brain ── Shared Project Memory
Antigravity ─┤
Copilot     ─┘
Windsurf ───┘
Zed         ─┘
```

When multiple coding assistants collaborate on the same repository, they share, validate, and evolve the same durable engineering memory — 100% offline, zero cloud egress, zero external database dependencies.

---

## Problem

Standard AI memory tools have fundamental limitations:

- **Network latency**: 150-800ms per recall when memory lives on a remote server
- **Privacy**: Source code sent to foreign servers
- **Context bloat**: Every session floods the context window
- **Agent isolation**: Claude and Cursor operate in silos, each starting from zero
- **Memory decay**: Outdated context from refactored code is never invalidated
- **Noise**: WIP commits and typos pollute the knowledge base

## Solution

Local Brain MCP addresses each limitation:

| Problem | How Local Brain MCP solves it |
|---|---|
| 150-800ms network latency per recall | ~3 ms p50 (5.7 ms p95, local 1k-memory benchmark) |
| Source code sent to foreign servers | 100% on-device, zero egress, total privacy |
| Context bloat on every session | Hard 250-token budget cap per recall |
| Agent isolation (Claude vs Cursor silos) | Shared multi-agent memory with provenance |
| Outdated context from refactored code | Git-diff invalidation marks old memories STALE |
| Conflicting or outdated guidelines | Contradiction detection with 0.60x ranking penalty |
| WIP/typo commits pollute memory | Quality filter keeps only high-signal lessons |
| Monorepo noise across packages | Path-scoped queries, per-package namespacing |
| Duplicate memories waste tokens | Smart deduplication and merge on ingest |
| Decisions lost over time | Full memory lineage and trace across agents |

---

## Installation

Requires **Node.js >= 22.0.0**.

```bash
# Install globally from npm
npm install -g local-brain-mcp

# Verify
local-brain --version
```

Then continue with [Quick Start](#quick-start) below (`local-brain init` -> `ingest` -> `status`).

---

## Quick Start

```bash
# 1. Navigate to your Git repository
cd /path/to/your-project

# 2. Auto-detect installed AI editors and link MCP configuration
local-brain init

# 3. Ingest your Git history into the local brain database
local-brain ingest

# 4. Check multi-agent memory statistics
local-brain status

# 5. Start collaborating with Claude Code, Cursor, Antigravity, Copilot, Windsurf, or Zed
```

### CLI Experience

```
╭────────────────────────────────────────────────────╮
│                                                    │
│      ╭────────────╮                                │
│      │ ●        ● │                                │
│      │     >_     │                                │
│      │ ●   ●   ●  │                                │
│      ╰────────────╯                                │
│                                                    │
│      Local Brain MCP                               │
│      Shared Memory for AI Coding Agents            │
│                                                    │
╰────────────────────────────────────────────────────╯

✓ Local Brain initialized successfully

PROJECT       retail-gem-quest
MEMORY STORE  .git/brain.db
STATUS        ● ACTIVE
VERSION       1.3.1

MEMORIES      0
LESSONS       0
AGENTS        0

Ready for AI memory.
```

---

## MCP Tools Reference (7 Tools)

All tools carry complete MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) for full protocol compliance.

### 1. `brain_recall`
Semantically search your codebase memory across all agents with multi-factor ranking and strict token capping.

- **Annotations**: `readOnly: true`, `idempotent: true`
- **Formula**: Semantic similarity (45%) + File scope (20%) + Recency decay (10%) + Confidence (10%) + Importance (5%) + Cross-agent validation (5%) + Quality score (5%) x Status multiplier x Contradiction penalty.

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | **Yes** | Natural language search query (e.g. `"JWT refresh token rotation"`). |
| `file_path` | `string` | No | Repo-relative file path to focus search scope (e.g. `"src/auth/jwt.ts"`). |
| `max_items` | `number` | No | Maximum memories to return (1-10, default: `5`). |
| `category` | `string` | No | Filter by category: `fix`, `architecture`, `convention`, `bug`, `manual`. |
| `min_confidence` | `number` | No | Minimum confidence threshold (`0.0` to `1.0`). |
| `include_deprecated` | `boolean` | No | Include stale and deprecated memories (default: `false`). |
| `agent_filter` | `string` | No | Optional: restrict to memories created by a specific agent (e.g. `"cursor"`). |

---

### 2. `brain_learn`
Store a durable lesson, architecture decision, bug root-cause, or team convention with automatic quality filtering, multi-agent attribution, and contradiction checks.

- **Annotations**: `readOnly: false`, `idempotent: false`

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `lesson` | `string` | **Yes** | Actionable engineering rule or decision. |
| `category` | `string` | No | `fix`, `architecture`, `convention`, `bug`, `manual` (default: `manual`). |
| `file_path` | `string` | No | Primary file this lesson applies to. |
| `files` | `array` | No | Array of related file paths. |
| `confidence` | `number` | No | Confidence score `0.0` to `1.0` (default: `1.0`). |
| `importance` | `number` | No | Importance multiplier `0.1` to `2.0` (default: `1.0`). |
| `importance_level` | `string` | No | `low`, `medium`, `high`, `critical` (auto-inferred if omitted). |
| `agent` | `string` | No | Creating agent identifier (auto-detected if omitted). |
| `supersedes_id` | `number` | No | ID of older memory replaced by this lesson. |

---

### 3. `brain_validate`
Confirm that an existing memory was helpful and correct during the current coding session. Increments validation count, records the validating agent, and boosts retrieval confidence.

- **Annotations**: `readOnly: false`, `idempotent: false`

**Parameters:**
| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `number` | **Yes** | Memory ID to validate. |
| `agent` | `string` | No | Validating agent identifier (auto-detected if omitted). |

---

### 4. `brain_status`
Returns brain health, storage diagnostics, multi-agent breakdown, and validation metrics.

- **Annotations**: `readOnly: true`, `idempotent: true`

---

### 5. `brain_trace`
Show complete chronological memory history and agent attribution for a specific file.

- **Annotations**: `readOnly: true`, `idempotent: true`

---

### 6. `brain_forget`
Deprecate or permanently purge specific memories by ID, path, or text query.

- **Annotations**: `readOnly: false`, `destructive: true`, `idempotent: true`

---

### 7. `brain_prune`
Clean up stale or deprecated memories from the brain after major refactors.

- **Annotations**: `readOnly: false`, `destructive: true`

---

## CLI Commands

```bash
local-brain init                       # Auto-detect AI editors and install MCP configs
local-brain ingest [--commits 500]   # Ingest repository git history
local-brain query "<text>"           # Test semantic recall directly in terminal
local-brain learn "<lesson>"         # Store a manual lesson with optional --agent flag
local-brain validate <id>            # Validate and reinforce a memory ID
local-brain memories [--agent <ag>]  # List stored memories with filters
local-brain trace <filePath>         # Show chronological history for a file
local-brain status                   # Diagnostics and multi-agent breakdown
local-brain doctor                   # System and editor configuration checker
local-brain prune [--status stale]   # Remove stale or deprecated records
local-brain forget [--id <id>]       # Delete or deprecate memories
local-brain --no-color               # Disable color output (global option)
```

---

## Multi-Agent Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Claude Code │   │    Cursor    │   │  Antigravity │   │   Copilot    │
└───────┬──────┘   └───────┬──────┘   └───────┬──────┘   └───────┬──────┘
        │                  │                  │                  │
        └──────────────────┼──────────────────┼──────────────────┘
                           ▼
               ┌─────────────────────────┐
               │     Local Brain MCP     │
               │  (stdio / WAL SQLite)   │
               └────────────┬────────────┘
                           ▼
               ┌───────────────────────────────────┐
               │        Shared Memory DB           │
               │  • Multi-factor deterministic rank│
               │  • Cross-agent validation boost   │
               │  • Contradiction detection & penalty │
               │  • Project & agent provenance     │
               └───────────────────────────────────┘
```

For detailed multi-agent documentation, see [docs/multi-agent.md](docs/multi-agent.md) and [docs/architecture.md](docs/architecture.md).

**Memory is local.** Vercel does not host the local memory database. Each project's memory is scoped to its repository root under `.git/brain.db` (or `~/.config/local-brain/brain.db` when no repository root applies).

**Agent identity is provenance.** Agents do not automatically share context unless Local Brain tools (`brain_learn`, `brain_recall`, `brain_validate`) are invoked via MCP.

**Supported agents**: Claude Code, Cursor, Antigravity, GitHub Copilot, Windsurf, Zed. `local-brain init` auto-detects all six and writes their MCP configuration. Agents not found on the system are skipped.

---

## Node Version Requirements

Local Brain MCP requires Node.js **>= 22.0.0** (matching the `better-sqlite3` engine requirement). CI tests Node 22.x and 24.x.

---

## Testing & Evaluation

```bash
npm run test         # Run complete test suite (unit, integration, multi-agent, concurrency)
npm run typecheck    # Validate TypeScript types without emit
npm run benchmark    # Measure retrieval latency and SQLite WAL throughput
npm run eval         # Evaluate MRR@5 and Precision@3 against benchmark dataset
```

---

## Troubleshooting

Stuck? See [docs/troubleshooting.md](docs/troubleshooting.md) for installation,
editor integration, recall, and git-hook fixes — or run with `DEBUG=local-brain:*`
for namespaced debug output.

---

## Contributing

Local Brain MCP is published under the permissive MIT License. Contributions, issue reports, and integrations are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup and PR guidelines.

---

## License

MIT © cosmiccoder200x-sys
