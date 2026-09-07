# Multi-Agent Shared Memory in Local Brain MCP

Local Brain transforms from a single-agent memory store into a **shared, local-first memory layer for multi-agent software engineering**.

When multiple coding assistants (Claude Code, Cursor, Antigravity, Copilot, Windsurf, Zed) collaborate on the same repository, they read from and contribute to the same durable SQLite database.

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
           │  • Contradiction detection & pen. │
           │  • Project & agent provenance     │
           └───────────────────────────────────┘
```

---

## Concrete Agent Flow

A concrete example of how multiple agents share memory through Local Brain:

**Agent A learns**
1. Claude Code identifies a bug pattern while debugging `src/auth/jwt.ts`.
2. Claude Code invokes `brain_learn(lesson: "Use jose instead of jsonwebtoken for edge runtime", agent: "claude-code")`.
3. Local Brain stores the memory with quality score, provenance metadata, and agent attribution.

**Local Brain stores memory**
4. The memory is indexed into the embedded SQLite vector database with WAL concurrency.
5. Git metadata (branch, commit SHA, file scope) is attached for provenance.
6. Memory status is set to `active`.

**Agent B recalls**
7. Cursor later encounters a similar JWT issue in the same project.
8. Cursor invokes `brain_recall(query: "jwt auth edge runtime")`.
9. Local Brain returns the previously stored lesson with relevance score and token cap.

**Agent B improves knowledge**
10. Cursor validates the memory was helpful by calling `brain_validate(id, agent: "cursor")`.
11. Validation count increments and confidence receives a boost.

**Agent C recalls updated knowledge**
12. Antigravity works on the same codebase and recalls the validated memory.
13. The memory now carries cross-agent validation provenance.

---

## Key Capabilities

### 1. Zero-Config Multi-Agent Provenance
Every memory stored via `brain_learn` or git ingestion tracks:
- `agent`: The AI agent creating the memory (`claude-code`, `cursor`, `antigravity`, `copilot`, `windsurf`, or explicit override via `LOCAL_BRAIN_AGENT`).
- `project_id`: Stable 8-character deterministic SHA-256 hash derived from the git remote or workspace path.
- `commit_hash`, `branch`, `git_ref`: Exact git state when the lesson was learned.
- `files`: JSON array of all associated files and scopes.

**Agent identity is provenance.** Agents do not automatically share context unless Local Brain tools (`brain_learn`, `brain_recall`, `brain_validate`) are invoked via MCP.

### 2. Cross-Agent Memory Validation (`brain_validate`)
When Agent B consumes a memory created by Agent A and confirms it solved the issue:
1. Agent B invokes `brain_validate(id, agent)`.
2. `validation_count` increments.
3. Stored confidence receives a boost (+0.05, capped at 0.99).
4. `last_validated` timestamp updates.
5. In ranking, validated memories receive a priority boost in future recalls.

### 3. Contradiction Detection & Penalties
Software architectures evolve. When an agent learns a new rule that contradicts an existing memory (e.g., *"We migrated from library X to library Y; do not use X"*):
1. **Detection**: Local Brain matches semantic similarity (threshold ≥ 0.55) against active memories combined with linguistic negation indicators (*"no longer"*, *"replaced by"*, *"switched to"*, *"deprecated"*).
2. **Flagging**: Both the new and old memories are marked with `contradiction_flag = 1` and cross-referenced in `contradiction_ids`.
3. **Penalty**: Contradicted memories receive a **0.60x rank penalty** during recall.
4. **Transparency**: Recall outputs display a visible `⚠️ [CONTRADICTION DETECTED]` banner so agents and developers can review conflicting conventions.

### 4. Project Isolation
Memory stores are scoped deterministically to your repository root. Different projects cannot leak context into one another. Each project has its own `.local-brain/memory.db` file.

### 5. Concurrency Safety with SQLite WAL
Local Brain enables `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;`.
Multiple agents can read simultaneously while writes complete without database lock contention.

### 6. Vercel Does Not Host Your Memory
The website served by Vercel is static HTML/CSS/JS only. Vercel does not host the local memory database, the MCP server, or any SQLite operations. All memory operations occur locally on your machine.

---

## MCP Tools Reference

| Tool | Purpose | Annotations |
| :--- | :--- | :--- |
| `brain_recall` | Semantic memory search with multi-factor ranking, token budgeting, and optional agent filtering | `readOnly: true`, `idempotent: true` |
| `brain_learn` | Store durable lessons with quality evaluation, deduplication, and contradiction check | `readOnly: false`, `idempotent: false` |
| `brain_validate` | Validate and reinforce existing memory usefulness across agents | `readOnly: false`, `idempotent: false` |
| `brain_status` | Brain diagnostics, multi-agent breakdown, and validation counts | `readOnly: true`, `idempotent: true` |
| `brain_trace` | Full chronological file memory history with agent attribution | `readOnly: true`, `idempotent: true` |
| `brain_forget` | Deprecate or remove specific memories | `readOnly: false`, `destructive: true` |
| `brain_prune` | Clean up stale/deprecated records after refactoring | `readOnly: false`, `destructive: true` |

---

## Local-First Architecture

Local Brain is **local-first** by design:

- **No network requests required.** All memory operations happen within your local Node.js process.
- **No external database.** SQLite runs embedded in your project.
- **No cloud sync.** Memory stays on your device.
- **No API keys.** Deterministic embedded vectors run offline.
- **Project-scoped.** Each repository has its own isolated memory store.

Vercel serves only the static website (`public/` directory). It does not host the local memory database, the MCP server, or any SQLite operations.
