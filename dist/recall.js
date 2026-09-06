/**
 * recall.ts — Multi-factor deterministic semantic recall and ranking engine.
 *
 * Solves token bloat and relevance precision:
 *  ✅ Multi-factor ranking: semantic similarity (45%), scope precision (20%),
 *     recency (10%), confidence (10%), importance (10%), quality (5%)
 *  ✅ Status & Supersession penalties (active: 1.0, stale: 0.25, deprecated: 0.05)
 *  ✅ Hard token budget cap (MAX_RESPONSE_TOKENS = 250)
 *  ✅ Monorepo package scoping and file provenance
 *  ✅ Fast fallback to structured keyword search if vector matches are sparse
 */
import { embed, cosineSimilarity, estimateTokens } from './embeddings.js';
import { buildScopeFilter, derivePackageScope } from './scoping.js';
// ─── Token Budget ─────────────────────────────────────────────────────────────
export const MAX_RESPONSE_TOKENS = 250;
// ─── Deterministic Multi-Factor Ranking ────────────────────────────────────────
/**
 * Calculates recency score [0.0 - 1.0] from a timestamp string.
 */
function calculateRecencyScore(dateString) {
    try {
        const timestamp = new Date(dateString).getTime();
        const now = Date.now();
        const ageInDays = Math.max(0, (now - timestamp) / (1000 * 60 * 60 * 24));
        // Half-life of 90 days for recency decay
        return Math.exp(-ageInDays / 90);
    }
    catch {
        return 0.5;
    }
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
        catch { /* ignore */ }
    }
    // Same monorepo package scope
    if (targetPackageScope && mem.package_scope === targetPackageScope) {
        return 0.75;
    }
    // Unscoped/general memory applicable everywhere
    if (!mem.package_scope && !mem.file_path) {
        return 0.40;
    }
    // Different package scope
    return 0.10;
}
/**
 * Computes composite deterministic rank score for a candidate memory.
 */
export function computeRankScore(mem, similarity, targetFile, targetPackageScope) {
    const scopeScore = calculateScopeScore(mem, targetFile, targetPackageScope);
    const recencyScore = calculateRecencyScore(mem.updated_at || mem.created_at);
    const confidenceScore = mem.confidence ?? 1.0;
    const importanceScore = Math.min(1.0, (mem.importance ?? 1.0) / 2.0);
    const qualityScore = Math.min(1.0, (mem.quality_score ?? 1.0) / 2.0);
    // Status multiplier
    let statusMultiplier = 1.0;
    if (mem.status === 'stale') {
        statusMultiplier = 0.25;
    }
    else if (mem.status === 'deprecated') {
        statusMultiplier = 0.05;
    }
    // Superseded penalty
    if (mem.superseded_by !== null && mem.superseded_by !== undefined) {
        statusMultiplier = Math.min(statusMultiplier, 0.05);
    }
    // Weighted composite score (weights sum to 1.0)
    const rawScore = similarity * 0.45 +
        scopeScore * 0.20 +
        recencyScore * 0.10 +
        confidenceScore * 0.10 +
        importanceScore * 0.10 +
        qualityScore * 0.05;
    const finalRankScore = rawScore * statusMultiplier;
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
// ─── Keyword Fallback ─────────────────────────────────────────────────────────
function keywordSearch(db, query, scopeFilter, categoryFilter, statusFilter, targetFile, targetPackageScope) {
    const words = query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const pattern = `%${words.slice(0, 3).join('%')}%`;
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
    const rows = db.prepare(sql).all(pattern, pattern, ...scopeFilter.params, ...categoryFilter.params);
    return rows.map(r => computeRankScore(r, 0.6, targetFile, targetPackageScope))
        .sort((a, b) => b.rankScore - a.rankScore);
}
// ─── Formatter ────────────────────────────────────────────────────────────────
function formatMemory(mem) {
    let fileList = [];
    try {
        if (mem.files)
            fileList = JSON.parse(mem.files);
    }
    catch { /* ignore */ }
    if (mem.file_path && !fileList.includes(mem.file_path)) {
        fileList.unshift(mem.file_path);
    }
    const primaryFile = mem.file_path ?? (fileList[0] ?? 'general');
    const commitTag = mem.commit_hash ? ` @ ${mem.commit_hash.slice(0, 7)}` : '';
    const confPercent = Math.round((mem.confidence ?? 1.0) * 100);
    const statusTag = mem.status !== 'active' ? ` [${mem.status.toUpperCase()}]` : '';
    const supersededTag = mem.superseded_by ? ' [SUPERSEDED]' : '';
    const line = `• [${primaryFile}${commitTag}] (${mem.category}${statusTag}${supersededTag} | conf: ${confPercent}%): ${mem.summary.slice(0, 200)}`;
    return {
        formatted: {
            id: mem.id,
            category: mem.category,
            summary,
            file_path: mem.file_path,
            files: fileList,
            commit_hash: mem.commit_hash,
            author: mem.author,
            confidence: mem.confidence,
            importance: mem.importance,
            status: mem.status,
            similarity: Math.round(mem.similarity * 100) / 100,
            rank_score: mem.rankScore,
            superseded_by: mem.superseded_by,
        },
        line,
    };
}
// ─── Main Recall ──────────────────────────────────────────────────────────────
export async function recallMemories(db, options) {
    const { query, file_path, max_items = 5, category, include_deprecated = false, min_confidence = 0.0, } = options;
    const packageScope = derivePackageScope(file_path);
    const scopeFilter = buildScopeFilter(packageScope);
    const categoryFilter = category
        ? { sql: 'AND category = ?', params: [category] }
        : { sql: '', params: [] };
    const statusFilter = include_deprecated
        ? "status IN ('active', 'stale', 'deprecated')"
        : "status = 'active'";
    const queryEmbedding = embed(query);
    let candidates = vectorSearch(db, queryEmbedding, scopeFilter, categoryFilter, statusFilter, file_path, packageScope);
    // Filter by min confidence if specified
    if (min_confidence > 0) {
        candidates = candidates.filter(c => (c.confidence ?? 1.0) >= min_confidence);
    }
    // Fallback to keyword search if vector search found nothing
    if (candidates.length === 0) {
        candidates = keywordSearch(db, query, scopeFilter, categoryFilter, statusFilter, file_path, packageScope);
    }
    // Filter below minimum score threshold
    const filtered = candidates.filter(c => c.finalScore >= min_score);
    const memories = [];
    let totalTokens = 0;
    let truncated = false;
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
    }
    return { memories, total_tokens: totalTokens, truncated, query };
}
// ─── Markdown Output ──────────────────────────────────────────────────────────
export function formatRecallMarkdown(result, query) {
    if (result.memories.length === 0) {
        return `No memories found for: "${query}"`;
    }
    const lines = result.memories.map(m => {
        const primaryFile = m.file_path ?? 'general';
        const commitTag = m.commit_hash ? ` @ ${m.commit_hash.slice(0, 7)}` : '';
        const statusTag = m.status !== 'active' ? ` [${m.status.toUpperCase()}]` : '';
        const supersededTag = m.superseded_by ? ' [SUPERSEDED]' : '';
        const confTag = m.confidence < 1.0 ? ` | conf: ${Math.round(m.confidence * 100)}%` : '';
        return `• [${primaryFile}${commitTag}] (${m.category}${statusTag}${supersededTag}${confTag}): ${m.summary.slice(0, 200)}`;
    });
    const header = `## Brain Recall: "${query}"`;
    const footer = result.truncated
        ? `\n_Results truncated to stay within ${MAX_RESPONSE_TOKENS} token budget._`
        : '';
    return [header, ...lines, footer].filter(Boolean).join('\n');
}
// ─── File Trace ───────────────────────────────────────────────────────────────
export function traceFile(db, filePath) {
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return [];
    return db.prepare(`
    SELECT * FROM memories
    WHERE file_path = ? OR files LIKE ?
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 30
  `).all(filePath, `%"${filePath}"%`);
}
//# sourceMappingURL=recall.js.map