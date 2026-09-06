# Changelog

All notable changes to `local-brain-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
