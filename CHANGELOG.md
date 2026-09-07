# Changelog

All notable changes to `local-brain-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-09-07

### Fixed
- **Corrected Node.js requirement to `>= 22.0.0`** across `package.json`,
  `package-lock.json`, README, website, troubleshooting guide, and the
  `local-brain doctor` output (which now reads the requirement from
  `package.json` instead of a hardcoded string). `better-sqlite3@13` physically
  requires Node 22+, so the previous `>= 18` range permitted broken installs.
- Replaced unqualified "< 5 ms recall" claims with measured numbers
  (~3 ms p50, 5.7 ms p95, local 1k-memory benchmark) in README and website.
- Corrected the documented memory-store path from `.local-brain/memory.db` to
  the actual `.git/brain.db` in README, website, and `docs/multi-agent.md`.
- Removed stale `dist/schema.sql` build artifact from the published package.

## [1.3.0] - 2026-09-07

### Added
- **Centralized configuration (`src/config.ts`)**: all ranking weights, similarity thresholds, token budgets, and staleness settings in one place with `LOCAL_BRAIN_*` environment variable overrides.
- **Single source of truth for version (`src/version.ts`)**: CLI and MCP server now read the version from `package.json` at load time.
- **DEBUG-gated logging (`src/debug.ts`)**: namespace-based debug output (`DEBUG=local-brain:*`) across db, ingest, recall, invalidation, mcp, cli, and provenance modules.
- **ESLint + Prettier**: flat-config linting (`npm run lint`) and formatting (`npm run format` / `format:check`).
- **53 new tests** (158 total): CLI utilities, config defaults/overrides, and extended `embedBatch` coverage.
- **App-tile brand mark**: dark rounded-square logo with centered terminal prompt; light/dark-safe, legible at favicon size.
- **Website install bar**: copy-paste `npm install -g local-brain-mcp` hero snippet with versioned asset URLs.
- **PNG Open Graph image** (`public/og-image.png`) for X/Discord/Slack link previews that cannot render SVG.

### Changed
- Rebuilt website branding, accessibility (skip link, ARIA tabs/nav, reduced-motion), and mobile UX.
- Fixed Vercel caching: unhashed images now use `must-revalidate` instead of `immutable`.
- `engines` widened to Node `>=18.0.0` to match tested versions.
- Build simplified to `tsc` only (removed broken `copy-schema.mjs` step referencing non-existent `src/schema.sql`).
- Post-commit hook now resolves the CLI via `command -v`/local `node_modules` instead of `npm root -g`.
- Copy-to-clipboard buttons debounce rapid clicks.
- `ingestSingleCommit` filters by the target commit date instead of a hardcoded `1 day ago` window.

### Fixed
- 3 npm audit vulnerabilities (fast-uri, qs, uuid).
- CLI `memories` command validates `--status` against an allowlist and bounds `--limit`.
- Removed unused `VALID_PRUNE_STATUSES` constant and `readFileSync` import.

### Removed
- Dropped `copy-schema.mjs` build script (schema lives in `src/db.ts`).

## [1.2.0] - 2026-09-06

### Added
- **Multi-Agent Shared Memory Layer**: Cross-agent persistent collaboration supporting Claude Code, Cursor, Antigravity, GitHub Copilot, Windsurf, and Zed on the same repository memory.
- **`brain_validate` Tool & CLI Command**: Cross-agent validation mechanism allowing any agent to reinforce and validate memories from previous sessions, incrementing validation counts and boosting recall rankings.
- **Contradiction Detection & Penalties**: Automatic linguistic negation detection against existing active memories. Bilaterally flags conflicting memories and applies a 0.60× ranking penalty with visible `⚠️ [CONTRADICTION DETECTED]` recall warnings.
- **Zero-Config Agent & Project Provenance**: Automatically detects agent identity from process environment variables and derives deterministic 8-character project IDs from Git origin remotes.
- **CLI Enhancements**: Added `local-brain validate <id>`, `local-brain memories`, `--agent` flag for `learn`, and agent breakdowns in `local-brain status`.
- **Comprehensive Multi-Agent Test Suites**: Added `tests/multi-agent.test.js`, `tests/concurrency.test.js`, `tests/provenance.test.js`, `tests/contradiction.test.js`, and `tests/lifecycle.test.js`.
- **Documentation Overhaul**: Added `docs/multi-agent.md`, `docs/architecture.md`, and `docs/evaluation.md`.

### Changed
- Extended database schema with `project_id`, `agent`, `validated_by`, `validation_count`, `contradiction_flag`, `contradiction_ids`, and `importance_level` with non-destructive idempotent migrations.
- Enhanced deterministic ranking formula to incorporate validation boost (+5%) and contradiction penalties (0.60×).
- Enforced strict SQLite WAL journal mode and connection isolation for concurrent multi-agent reading and writing.

## [1.1.0] - 2026-09-06

### Added
- **`brain_status` Tool**: Exposes read-only operational telemetry, memory counts, database size, Git HEAD info, and engine capabilities.
- **`brain_forget` Tool & CLI Command**: Added controlled single-memory deletion tool by integer ID.
- **Multi-Factor Ranking Engine**: Added transparent composite scoring combining Semantic Similarity (60%), Category Importance (15%), Freshness Decay (15%), and Confidence (10%).
- **Code-Aware Feature Hashing**: Enhanced embedding tokenizer with camelCase, snake_case, dot notation identifier splitting, stopword filtering, and BM25 sublinear term frequency weighting.
- **Security Hardening**: Implemented `sanitizeFilePath` preventing directory traversal (`..`) and null-byte injection.
- **Automated Benchmarking Suite**: Added `scripts/benchmark.mjs` measuring embedding throughput, insertion latency, and scaled recall latency.
- **Retrieval Evaluation Suite**: Added `scripts/evaluate-retrieval.mjs` measuring P@1, P@3, P@5, Recall@5, MRR, and NDCG@5.
- **GitHub Actions CI**: Added multi-version matrix testing across Node 18, 20, 22, and 24.
- **Open-Source Governance**: Added `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `CODE_OF_CONDUCT.md`.

### Changed
- Refactored `mcp-server.ts` with strict input schema validation, bounds checking (rejecting NaN, negative items, excessive lengths), and defensive error handling.
- Upgraded `better-sqlite3` to modern version supporting Node 18 through Node 24.
- Enhanced `tsconfig.json` with strict `NodeNext` ESM configuration and full type safety.
- Completely overhauled `README.md` with verified architecture, tool references, and quick-start guides.

### Removed
- Removed unused `vectra` dependency from `package.json`.

## [1.0.0] - Initial Release
- Initial release of local-brain-mcp with `brain_recall`, `brain_learn`, `brain_trace`, and `brain_prune`.
