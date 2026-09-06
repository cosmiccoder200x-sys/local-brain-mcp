# Local Brain MCP — Evaluation & Benchmark Methodology

This document outlines the evaluation framework, performance benchmarks, and retrieval metrics used to validate Local Brain MCP.

---

## 1. Retrieval Metrics

| Metric | Target | Description |
| :--- | :--- | :--- |
| **MRR@5 (Mean Reciprocal Rank)** | ≥ 0.85 | Measures how closely the top ranked result matches the intended engineering context. |
| **Precision@3** | ≥ 0.80 | Fraction of top-3 returned memories that are strictly relevant to the target file/query. |
| **Recall Latency** | < 10 ms | Time to retrieve, score, filter, and format responses locally. |
| **Token Budget Compliance** | 100% | Every recall response is guaranteed under the 250-token cap. |
| **Noise Rejection Rate** | ≥ 95% | Ephemeral commands, temporary logs, and non-actionable strings filtered out. |

---

## 2. Running Evaluation & Benchmarks

Local Brain provides automated benchmarking scripts:

```bash
# Run comprehensive retrieval evaluation against ground-truth queries
npm run eval

# Run vector search and SQLite concurrency benchmarks
npm run benchmark
```

---

## 3. Evaluation Dataset Structure

Retrieval tests evaluate:
1. **Direct Keyword & Topic Matches**: "JWT expiration", "database pooling", "Redis caching".
2. **File & Monorepo Scoping**: Prioritizing memories tagged with matching package scopes over general or mismatched paths.
3. **Supersession & Deprecation**: Ensuring superseded or stale memories rank below active updates.
4. **Contradiction Penalty Verification**: Verifying that active memories contradicting current conventions receive the 0.60× penalty.
5. **Multi-Agent Cross-Recall**: Validating that lessons contributed by Claude Code are accurately ranked and retrieved in Cursor / Antigravity sessions.
