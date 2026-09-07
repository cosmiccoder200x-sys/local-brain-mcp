/**
 * recall.ts — Multi-factor deterministic semantic recall and ranking engine.
 *
 * Solves token bloat and relevance precision:
 *  ✅ Multi-factor ranking: semantic similarity (45%), scope precision (20%),
 *     recency (10%), confidence (10%), importance (5%), validation (5%), quality (5%)
 *  ✅ Status & Supersession penalties (active: 1.0, stale: 0.25, deprecated: 0.05)
 *  ✅ Contradiction penalty (0.60× for flagged contradicting memories)
 *  ✅ Multi-agent provenance attribution and agent filtering
 *  ✅ Hard token budget cap (MAX_RESPONSE_TOKENS = 250)
 *  ✅ Monorepo package scoping and file provenance
 *  ✅ Fast fallback to structured keyword search if vector matches are sparse
 */
import { embed, cosineSimilarity, estimateTokens } from "./embeddings.js";
import { buildScopeFilter, derivePackageScope, sanitizeFilePath } from "./scoping.js";
import { MAX_RESPONSE_TOKENS, FRESHNESS_HALF_LIFE_DAYS, RANKING_WEIGHTS, STATUS_MULTIPLIERS, CONTRADICTION_PENALTY, } from "./config.js";
import { debugLog } from "./debug.js";
// Re-export for backward compatibility with tests
export { MAX_RESPONSE_TOKENS } from "./config.js";
// ─── Deterministic Multi-Factor Ranking ────────────────────────────────────────
/**
 * Calculates recency score [0.0 - 1.0] from a timestamp string.
 */
export function calculateFreshness(dateString) {
    try {
        const timestamp = new Date(dateString).getTime();
        const now = Date.now();
        const ageInDays = Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
        // Half-life for freshness score ~0.50
        return Math.exp((-ageInDays * Math.LN2) / FRESHNESS_HALF_LIFE_DAYS);
    }
    catch (e) {
        debugLog("recall", "Failed to calculate freshness for date %s: %s", dateString, e instanceof Error ? e.message : String(e));
        return 0.5;
    }
}
/**
 * Simplified scoring function for external callers and tests.
 * The active recall path uses computeRankScore instead.
 */
export function computeFinalScore(similarity, category, createdAt, importance = 1.0, confidence = 1.0) {
    const freshness = calculateFreshness(createdAt);
    const catMultiplier = category === "architecture" || category === "fix" ? 1.25 : 1.0;
    const raw = similarity * 0.45 + freshness * 0.2 + confidence * 0.15 + Math.min(1.0, importance / 1.5) * 0.2;
    const finalScore = Math.min(1.0, raw * catMultiplier);
    return { finalScore: Math.round(finalScore * 1000) / 1000 };
}
function calculateRecencyScore(dateString) {
    return calculateFreshness(dateString);
}
/**
 * Calculates scope alignment score [0.0 - 1.0] between a target file and memory.
 */
function calculateScopeScore(mem, targetFile, targetPackageScope) {
    if (!targetFile && !targetPackageScope) {
        return 0.5; // Neutral baseline when no scope filter is requested
    }
    // Exact file match
    if (targetFile && mem.file_path === targetFile) {
        return 1.0;
    }
    // Associated files array match
    if (targetFile && mem.files) {
        try {
            const files = JSON.parse(mem.files);
            if (files.includes(targetFile))
                return 0.95;
        }
        catch (e) {
            debugLog("recall", "Failed to parse files JSON for memory %d: %s", mem.id, e instanceof Error ? e.message : String(e));
        }
    }
    // Same monorepo package scope
    if (targetPackageScope && mem.package_scope === targetPackageScope) {
        return 0.75;
    }
    // Unscoped/general memory applicable everywhere
    if (!mem.package_scope && !mem.file_path) {
        return 0.4;
    }
    // Different package scope
    return 0.1;
}
/**
 * Computes composite deterministic rank score for a candidate memory.
 *
 * Formula (Phase 3):
 *   rank = (similarity        × 0.45)   — semantic relevance
 *        + (scope_score       × 0.20)   — file/package scope alignment
 *        + (recency_score     × 0.10)   — exponential decay (90d half-life)
 *        + (confidence        × 0.10)   — stored confidence
 *        + (importance        × 0.05)   — importance multiplier (normalized 0–1)
 *        + (validation_score  × 0.05)   — validation boost (capped at 1.0)
 *        + (quality_score     × 0.05)   — quality assessment score (normalized 0–1)
 *
 *   × status_multiplier     (active=1.0, stale=0.25, deprecated=0.05)
 *   × contradiction_penalty (no_contradiction=1.0, contradicted=0.60)
 */
function computeRankScore(mem, similarity, targetFile, targetPackageScope) {
    const scopeScore = calculateScopeScore(mem, targetFile, targetPackageScope);
    const recencyScore = calculateRecencyScore(mem.created_at);
    const confidenceScore = mem.confidence ?? 1.0;
    const importanceScore = Math.min(1.0, (mem.importance ?? 1.0) / 2.0);
    const validationScore = Math.min(1.0, (mem.validation_count ?? 0) * 0.25);
    const qualityScore = mem.quality_score ?? 1.0;
    const statusMultiplier = STATUS_MULTIPLIERS[mem.status] ?? 1.0;
    const contradictionPenalty = mem.contradiction_flag === 1 ? CONTRADICTION_PENALTY : 1.0;
    const rawScore = similarity * RANKING_WEIGHTS.similarity +
        scopeScore * RANKING_WEIGHTS.scope +
        recencyScore * RANKING_WEIGHTS.recency +
        confidenceScore * RANKING_WEIGHTS.confidence +
        importanceScore * RANKING_WEIGHTS.importance +
        validationScore * RANKING_WEIGHTS.validation +
        qualityScore * RANKING_WEIGHTS.quality;
    const finalRankScore = rawScore * statusMultiplier * contradictionPenalty;
    return {
        ...mem,
        similarity,
        scopeScore,
        recencyScore,
        rankScore: Math.round(finalRankScore * 1000) / 1000,
    };
}
// ─── Vector Search ────────────────────────────────────────────────────────────
function vectorSearch(db, queryEmbedding, scopeFilter, categoryFilter, statusFilter, targetFile, targetPackageScope) {
    const sql = `
    SELECT *
    FROM memories
    WHERE ${statusFilter}
      ${scopeFilter.sql}
      ${categoryFilter.sql}
  `;
    const rows = db.prepare(sql).all(...scopeFilter.params, ...categoryFilter.params);
    const scored = [];
    for (const row of rows) {
        let similarity = 0.5; // fallback neutral score
        if (row.embedding && row.embedding.length > 0) {
            const buf = row.embedding;
            const memVec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
            similarity = cosineSimilarity(queryEmbedding, memVec);
        }
        scored.push(computeRankScore(row, similarity, targetFile, targetPackageScope));
    }
    // Sort by composite rank score descending
    scored.sort((a, b) => b.rankScore - a.rankScore);
    return scored;
}
// ─── Keyword Search Fallback ──────────────────────────────────────────────────
function keywordSearch(db, query, scopeFilter, categoryFilter, statusFilter, targetFile, targetPackageScope) {
    const words = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);
    const pattern = `%${words.slice(0, 3).join("%")}%`;
    const sql = `
    SELECT *
    FROM memories
    WHERE ${statusFilter}
      AND (content LIKE ? OR summary LIKE ?)
      ${scopeFilter.sql}
      ${categoryFilter.sql}
    ORDER BY created_at DESC
    LIMIT 20
  `;
    const rows = db
        .prepare(sql)
        .all(pattern, pattern, ...scopeFilter.params, ...categoryFilter.params);
    return rows
        .map((r) => computeRankScore(r, 0.6, targetFile, targetPackageScope))
        .sort((a, b) => b.rankScore - a.rankScore);
}
// ─── Formatter ────────────────────────────────────────────────────────────────
function formatMemory(mem) {
    let fileList = [];
    try {
        if (mem.files)
            fileList = JSON.parse(mem.files);
    }
    catch (e) {
        debugLog("recall", "Failed to parse files in formatMemory: %s", e instanceof Error ? e.message : String(e));
    }
    if (mem.file_path && !fileList.includes(mem.file_path)) {
        fileList.unshift(mem.file_path);
    }
    const primaryFile = mem.file_path ?? fileList[0] ?? "general";
    const commitTag = mem.commit_hash ? ` @ ${mem.commit_hash.slice(0, 7)}` : "";
    const confPercent = Math.round((mem.confidence ?? 1.0) * 100);
    const statusTag = mem.status !== "active" ? ` [${mem.status.toUpperCase()}]` : "";
    const supersededTag = mem.superseded_by ? " [SUPERSEDED]" : "";
    const agentTag = mem.agent && mem.agent !== "unknown" ? ` [agent: ${mem.agent}]` : "";
    const validatedTag = (mem.validation_count ?? 0) > 0 ? ` [validated: ${mem.validation_count}×]` : "";
    const contradictionTag = mem.contradiction_flag === 1 ? " [CONTRADICTION DETECTED]" : "";
    const line = `• [${primaryFile}${commitTag}] (${mem.category}${statusTag}${supersededTag}${agentTag}${validatedTag}${contradictionTag} | conf: ${confPercent}%): ${mem.summary.slice(0, 200)}`;
    return {
        formatted: {
            id: mem.id,
            category: mem.category,
            summary: mem.summary,
            file_path: mem.file_path,
            files: fileList,
            commit_hash: mem.commit_hash,
            author: mem.author,
            agent: mem.agent ?? "unknown",
            confidence: mem.confidence,
            importance: mem.importance,
            status: mem.status,
            similarity: Math.round(mem.similarity * 100) / 100,
            rank_score: mem.rankScore,
            superseded_by: mem.superseded_by,
            validation_count: mem.validation_count ?? 0,
            contradiction_flag: mem.contradiction_flag ?? 0,
            importance_level: mem.importance_level ?? "medium",
        },
        line,
    };
}
// ─── Main Recall ──────────────────────────────────────────────────────────────
export async function recallMemories(db, options) {
    const { query, file_path, max_items = 5, category, include_deprecated = false, min_confidence = 0.0, agent_filter, project_id, } = options;
    const sanitizedPath = sanitizeFilePath(file_path);
    const packageScope = derivePackageScope(sanitizedPath);
    const scopeFilter = buildScopeFilter(packageScope);
    const categoryFilter = category
        ? { sql: "AND category = ?", params: [category] }
        : { sql: "", params: [] };
    const statusFilter = include_deprecated
        ? "status IN ('active', 'stale', 'deprecated')"
        : "status = 'active'";
    const queryEmbedding = embed(query);
    let candidates = vectorSearch(db, queryEmbedding, scopeFilter, categoryFilter, statusFilter, file_path, packageScope);
    // Filter by min confidence if specified
    if (min_confidence > 0) {
        candidates = candidates.filter((c) => (c.confidence ?? 1.0) >= min_confidence);
    }
    // Filter by agent if specified
    if (agent_filter) {
        candidates = candidates.filter((c) => c.agent === agent_filter);
    }
    // Filter by project_id if specified
    if (project_id) {
        candidates = candidates.filter((c) => !c.project_id || c.project_id === project_id);
    }
    // Fallback to keyword search if vector search found nothing
    if (candidates.length === 0) {
        candidates = keywordSearch(db, query, scopeFilter, categoryFilter, statusFilter, file_path, packageScope);
        if (min_confidence > 0) {
            candidates = candidates.filter((c) => (c.confidence ?? 1.0) >= min_confidence);
        }
        if (agent_filter) {
            candidates = candidates.filter((c) => c.agent === agent_filter);
        }
        if (project_id) {
            candidates = candidates.filter((c) => !c.project_id || c.project_id === project_id);
        }
    }
    const memories = [];
    let totalTokens = 0;
    let truncated = false;
    const agent_breakdown = {};
    let contradictions = 0;
    for (const mem of candidates) {
        if (memories.length >= max_items)
            break;
        const { formatted, line } = formatMemory(mem);
        const cost = estimateTokens(line);
        if (totalTokens + cost > MAX_RESPONSE_TOKENS && memories.length > 0) {
            truncated = true;
            break;
        }
        memories.push(formatted);
        totalTokens += cost;
        const ag = formatted.agent || "unknown";
        agent_breakdown[ag] = (agent_breakdown[ag] || 0) + 1;
        if (formatted.contradiction_flag === 1) {
            contradictions++;
        }
    }
    return {
        memories,
        total_tokens: totalTokens,
        truncated,
        query,
        agent_breakdown,
        contradictions,
    };
}
// ─── Markdown Output ──────────────────────────────────────────────────────────
export function formatRecallMarkdown(result, query) {
    if (result.memories.length === 0) {
        return `No memories found for: "${query}"`;
    }
    const lines = result.memories.map((m) => {
        const primaryFile = m.file_path ?? "general";
        const commitTag = m.commit_hash ? ` @ ${m.commit_hash.slice(0, 7)}` : "";
        const statusTag = m.status !== "active" ? ` [${m.status.toUpperCase()}]` : "";
        const supersededTag = m.superseded_by ? " [SUPERSEDED]" : "";
        const confTag = m.confidence < 1.0 ? ` | conf: ${Math.round(m.confidence * 100)}%` : "";
        const agentTag = m.agent && m.agent !== "unknown" ? ` [agent: ${m.agent}]` : "";
        const validatedTag = m.validation_count > 0 ? ` [validated: ${m.validation_count}×]` : "";
        const contradictionTag = m.contradiction_flag === 1 ? " ⚠️ [CONTRADICTION DETECTED]" : "";
        return `• [${primaryFile}${commitTag}] (${m.category}${statusTag}${supersededTag}${agentTag}${validatedTag}${contradictionTag}${confTag}): ${m.summary.slice(0, 200)}`;
    });
    const header = `## Brain Recall: "${query}"`;
    const footer = result.truncated
        ? `\n_Results truncated to stay within ${MAX_RESPONSE_TOKENS} token budget._`
        : "";
    return [header, ...lines, footer].filter(Boolean).join("\n");
}
// ─── File Trace ───────────────────────────────────────────────────────────────
export function traceFile(db, filePath) {
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return [];
    return db
        .prepare(`
    SELECT * FROM memories
    WHERE file_path = ? OR files LIKE ?
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 30
  `)
        .all(filePath, `%"${filePath}"%`);
}
//# sourceMappingURL=recall.js.map