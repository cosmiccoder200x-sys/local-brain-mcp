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

---

## 5. Quality & Noise Filtering (`src/quality.ts`)

Evaluates whether candidate memories have sufficient engineering quality to be persisted. Operates as a gate in the `brain_learn` pipeline — low-signal content is rejected before it reaches the database.

### 5.1 Memory Quality Assessment (`evaluateMemoryQuality`)

Returns a `QualityAssessment` with an `isQuality` boolean and a numeric `score` (0.0–2.0).

**Evaluation stages:**
1. **Length gate** — Content shorter than 8 characters is rejected as trivial.
2. **Noise pattern rejection** — Matches against `TRIVIAL_PATTERNS`: bare shell commands (`git status`, `npm install`, `cd`, `ls`, …), debug stubs (`console.log`, `debugger`), and filler strings (`asdf`, `foo`, `bar`, `wip`).
3. **Category weighting** — `architecture` and `fix` categories receive +0.3; `bug` receives +0.2.
4. **High-signal terminology boost** — Matches against `HIGH_VALUE_PATTERNS` (e.g. "root cause", "race condition", "breaking change", "security", "convention"). Each match adds +0.15, capped at +0.5.
5. **Structure boost** — Content containing backticks or newlines receives +0.2 (indicates code snippets or multi-line reasoning).

The default score is 1.0; the final score is clamped and rounded to two decimal places.

### 5.2 Noise Filtering

`TRIVIAL_PATTERNS` — Rejects ephemeral commands and debugging noise:
- Git CLI commands (`git status`, `git add`, …)
- Package manager commands (`npm install`, `yarn add`, …)
- Filesystem commands (`cd`, `ls`, `mkdir`, …)
- Debug output (`console.log`, `debugger`, `System.out.println`)
- Filler strings (`asdf`, `wip`, `temp`, `hello world`)

`HIGH_VALUE_PATTERNS` — Boosts durable engineering signals:
- Root cause analysis, race conditions, concurrency bugs
- Architecture decisions, conventions, migration notes
- Security and performance concerns
- Breaking changes, API contracts
- Imperative guidelines ("always", "never", "must", "do not")

### 5.3 Provenance Extraction

- **`extractReferencedFiles(text)`** — Parses file paths from memory content using a regex that matches filenames with known extensions (`.ts`, `.js`, `.py`, `.sql`, `.yaml`, etc.). Returns a deduplicated array of referenced files, excluding HTTP URLs.
- **`detectImportanceLevel(content)`** — Infers `low | medium | high | critical` from keyword analysis. "critical" is assigned for security vulnerabilities, data loss, breaking changes. "high" for architecture and convention keywords. "low" for trivial/minor markers.

---

## 6. Directory Scoping & Path Sanitization (`src/scoping.ts`)

Provides monorepo-aware query filtering so that recalls surface only memories relevant to the current sub-package, and all file paths are normalized and sanitized before database operations.

### 6.1 Path Sanitization (`sanitizeFilePath`)

Normalizes and sanitizes file paths to prevent directory traversal and null-byte injection:
- Strips null bytes and control characters (`\x00`–`\x1f`, `\x7f`).
- Normalizes backslashes to POSIX forward slashes.
- Strips Windows drive prefixes (e.g. `C:/`).
- Resolves `..` segments to prevent traversal above the repository root.
- Returns `null` for empty or invalid paths.

### 6.2 Package Scope Detection (`derivePackageScope`)

Derives a monorepo package scope from a file path by scanning for conventional root directories:

| Root pattern | Example path | Derived scope |
|---|---|---|
| `packages/` | `packages/auth/src/jwt.ts` | `packages/auth` |
| `apps/` | `apps/dashboard/pages/index.tsx` | `apps/dashboard` |
| `libs/` | `libs/shared/utils.ts` | `libs/shared` |
| `services/` | `services/api/handler.ts` | `services/api` |
| `modules/` | `modules/auth/login.ts` | `modules/auth` |

Returns `null` for flat project layouts (e.g. `src/utils/helpers.ts`).

### 6.3 Query Filtering (`buildScopeFilter`)

Generates a parameterized SQLite WHERE clause for scoped queries:
```sql
AND (package_scope = ? OR package_scope LIKE ? OR package_scope IS NULL)
```
The `IS NULL` clause ensures memories without an explicit scope (e.g. global conventions) are always included.

### 6.4 Additional Utilities

- **`detectWorkingScope(cwd?)`** — Auto-detects the package scope from `process.cwd()` or an explicit path. Used by CLI and MCP server when no `file_path` argument is provided.
- **`toRelativePath(filePath, repoRoot)`** — Converts absolute paths to repo-relative form, then sanitizes the result.

---

## 7. Centralized Configuration (`src/config.ts`)

All tunable thresholds, ranking weights, and magic numbers are defined as exported constants in a single module. Environment variable overrides are supported for key settings via `envInt()` and `envFloat()` helper functions.

### 7.1 Recall & Ranking Constants

| Constant | Default | Env Override | Description |
|---|---|---|---|
| `MAX_RESPONSE_TOKENS` | `250` | `LOCAL_BRAIN_MAX_TOKENS` | Hard ceiling on recall output tokens |
| `FRESHNESS_HALF_LIFE_DAYS` | `120` | `LOCAL_BRAIN_FRESHNESS_HALF_LIFE` | Exponential decay half-life for recency scoring |
| `DUPLICATE_SIMILARITY_THRESHOLD` | `0.90` | `LOCAL_BRAIN_DUP_THRESHOLD` | Cosine similarity for near-duplicate detection |
| `CONTRADICTION_SIMILARITY_THRESHOLD` | `0.35` | `LOCAL_BRAIN_CONTRADICTION_THRESHOLD` | Cosine similarity for contradiction detection |
| `MAX_LESSON_LENGTH` | `10000` | `LOCAL_BRAIN_MAX_LESSON_LENGTH` | Max characters per stored lesson |
| `STALE_CHANGE_THRESHOLD` | `0.30` | `LOCAL_BRAIN_STALE_THRESHOLD` | File change fraction that triggers memory invalidation |
| `VALIDATION_CONFIDENCE_BOOST` | `0.05` | — | Confidence increment per validation event |
| `MAX_CONFIDENCE` | `0.99` | — | Hard cap on memory confidence |

### 7.2 Ranking Weights (`RANKING_WEIGHTS`)

```ts
{
  similarity:  0.45,   // cosine semantic relevance
  scope:       0.20,   // file / package / unscoped match
  recency:     0.10,   // freshness decay
  confidence:  0.10,   // stored confidence rating
  importance:  0.05,   // normalized importance multiplier
  validation:  0.05,   // cross-agent validation boost
  quality:     0.05,   // heuristic quality score
}
```

### 7.3 Status Multipliers (`STATUS_MULTIPLIERS`)

```ts
{ active: 1.0, stale: 0.25, deprecated: 0.05 }
```

### 7.4 Other Constants

- `CONTRADICTION_PENALTY` — `0.60` multiplier applied to memories flagged as contradicted.
- `CLI_MAX_MEMORIES` — `500`, maximum memories displayed in the CLI `memories` command.
- `EMBEDDING_DIM` — `384`, dimensionality of the local embedding vector.

---

## 8. Version Management (`src/version.ts`)

Single source of truth for the package version, read from `package.json` at module load time. Exported as the constant `VERSION`.

- Reads `package.json` relative to the module's `__dirname` using `readFileSync`.
- Falls back to `'0.0.0'` if `package.json` is unreadable.
- Prevents version drift between `cli.ts`, `mcp-server.ts`, and `package.json` — the version is always resolved from one location.

---

## 9. Debug Logging (`src/debug.ts`)

A lightweight, `DEBUG`-gated logging utility. Messages are only emitted to `stderr` when the corresponding namespace is enabled via the `DEBUG` environment variable.

### 9.1 Usage

```ts
import { debugLog } from './debug.js';
debugLog('db', 'Migration failed for column %s', columnName);
```

### 9.2 Enabling Debug Output

Set the `DEBUG` environment variable using comma-separated namespaces:

| Value | Effect |
|---|---|
| `DEBUG=local-brain:*` | Enable all namespaces |
| `DEBUG=local-brain:db` | Enable only DB-related logs |
| `DEBUG=local-brain:ingest,local-brain:recall` | Enable multiple specific namespaces |

### 9.3 Namespaces in Use

- `db` — Database migration, schema, and query logging.
- `mcp` — MCP server startup, tool dispatch, and error handling.
- `ingest` — Git history ingestion and commit processing.
- `recall` — Semantic search and ranking diagnostics.
