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

## Key Capabilities

### 1. Zero-Config Multi-Agent Provenance
Every memory stored via `brain_learn` or git ingestion tracks:
- `agent`: The AI agent creating the memory (`claude-code`, `cursor`, `antigravity`, `copilot`, `windsurf`, or explicit override via `LOCAL_BRAIN_AGENT`).
- `project_id`: Stable 8-character deterministic SHA-256 hash derived from the git remote or workspace path.
- `commit_hash`, `branch`, `git_ref`: Exact git state when the lesson was learned.
- `files`: JSON array of all associated files and scopes.

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
3. **Penalty**: Contradicted memories receive a **0.60× rank penalty** during recall.
4. **Transparency**: Recall outputs display a visible `⚠️ [CONTRADICTION DETECTED]` banner so agents and developers can review conflicting conventions.

### 4. Concurrency Safety with SQLite WAL
Local Brain enables `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;`.
Multiple agents can read simultaneously while writes complete without database lock contention.

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
