# Local Brain MCP — Architecture (v1.2.0)

Local Brain is a local-first, zero-external-dependency persistent memory infrastructure designed specifically for AI coding agents operating across multi-agent setups.

---

## 1. Core Principles

- **Zero Cloud & Zero Network Latency**: Runs entirely on the developer's machine using synchronous, pure-C SQLite (`better-sqlite3`).
- **Deterministic Multi-Factor Ranking**: Avoids opaque probabilistic retrieval by computing clear, explainable composite scores.
- **Budget-Capped Tokens**: Hard ceiling (`MAX_RESPONSE_TOKENS = 250`) on recall output to prevent prompt bloat and context poisoning.
- **Multi-Agent Interoperability**: Seamlessly shares memory across Claude Code, Cursor, Antigravity, Copilot, Windsurf, and CLI tools.
- **Quality & Noise Filtering**: Conservative heuristic filter discards trivial shell commands and ephemeral debugging while retaining core engineering decisions.

---

## 2. Storage & Vector Architecture

Vector embeddings (384-dimensional) are stored directly as raw binary `BLOB` records (`Float32Array`) in SQLite.

```
memories Table
├── id (INTEGER PK AUTOINCREMENT)
├── category (fix | architecture | convention | bug | manual)
├── content (TEXT)
├── summary (TEXT)
├── file_path (TEXT)
├── files (JSON TEXT)
├── package_scope (TEXT)
├── commit_hash (TEXT)
├── git_ref (TEXT)
├── author (TEXT)
├── branch (TEXT)
├── project_id (TEXT 8-char deterministic hash)
├── agent (TEXT: claude-code | cursor | antigravity | copilot | windsurf)
├── validated_by (TEXT)
├── validation_count (INTEGER DEFAULT 0)
├── contradiction_flag (INTEGER DEFAULT 0)
├── contradiction_ids (JSON TEXT)
├── importance_level (low | medium | high | critical)
├── confidence (REAL)
├── importance (REAL)
├── quality_score (REAL)
├── status (active | stale | deprecated)
├── source (git-ingest | manual | session)
├── superseded_by (FK -> memories.id)
├── supersedes_id (FK -> memories.id)
├── last_validated (DATETIME)
├── token_count (INTEGER)
├── embedding (BLOB: 384-dim Float32Array)
├── created_at (DATETIME)
└── updated_at (DATETIME)
```

---

## 3. Deterministic Ranking Formula

```
rank = (similarity        × 0.45)   — cosine semantic relevance [0.0 - 1.0]
     + (scope_score       × 0.20)   — exact file (1.0), pkg scope (0.75), unscoped (0.40), mismatch (0.10)
     + (recency_score     × 0.10)   — exponential decay with 90-day half-life
     + (confidence        × 0.10)   — stored confidence [0.0 - 1.0]
     + (importance_score  × 0.05)   — normalized importance multiplier
     + (validation_score  × 0.05)   — cross-agent validation boost (0.25× per validation, max 1.0)
     + (quality_score     × 0.05)   — heuristic quality score

final_score = rank × status_multiplier × contradiction_penalty

where:
  status_multiplier:     active = 1.0, stale = 0.25, deprecated = 0.05
  contradiction_penalty: no contradiction = 1.0, contradicted = 0.60
```

---

## 4. Concurrency & WAL Execution

- SQLite is configured with `PRAGMA journal_mode = WAL;` and `PRAGMA synchronous = NORMAL;`.
- Readers execute concurrently without blocking writers.
- Writes acquire brief transactional locks safely handled by SQLite's busy handler.
