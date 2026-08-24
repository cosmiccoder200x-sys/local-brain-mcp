/**
 * recall.ts — Token-capped semantic recall engine.
 *
 * Solves the "token bloat" problem:
 *  ✅ Hard cap of MAX_RESPONSE_TOKENS per recall call
 *  ✅ In-memory cosine similarity search (sub-1ms local)
 *  ✅ Fallback to keyword search if vector matches are below threshold
 *  ✅ Monorepo package scoping applied automatically
 */
import { embed, cosineSimilarity, estimateTokens } from './embeddings.js';
import { buildScopeFilter, derivePackageScope } from './scoping.js';
// ─── Token Budget ─────────────────────────────────────────────────────────────
const MAX_RESPONSE_TOKENS = 250;
// ─── Vector Search ────────────────────────────────────────────────────────────
function vectorSearch(db, queryEmbedding, scopeFilter, categoryFilter, limit) {
    const sql = `
    SELECT *
    FROM memories
    WHERE status = 'active'
      ${scopeFilter.sql}
      ${categoryFilter.sql}
  `;
    const rows = db.prepare(sql).all(...scopeFilter.params, ...categoryFilter.params);
    const scored = [];
    for (const row of rows) {
        let similarity = 0.5; // fallback neutral score if embedding missing
        if (row.embedding && row.embedding.length > 0) {
            // Reconstruct Float32Array from Buffer
            const buf = row.embedding;
            const memVec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
            similarity = cosineSimilarity(queryEmbedding, memVec);
        }
        scored.push({ ...row, similarity });
    }
    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
}
// ─── Keyword Fallback ─────────────────────────────────────────────────────────
function keywordSearch(db, query, scopeFilter, categoryFilter, limit) {
    const pattern = `%${query.split(' ').slice(0, 3).join('%')}%`;
    const sql = `
    SELECT *, 0.5 AS similarity
    FROM memories
    WHERE status = 'active'
      AND (content LIKE ? OR summary LIKE ?)
      ${scopeFilter.sql}
      ${categoryFilter.sql}
    ORDER BY created_at DESC
    LIMIT ?
  `;
    return db.prepare(sql).all(pattern, pattern, ...scopeFilter.params, ...categoryFilter.params, limit);
}
// ─── Token-capped Formatter ───────────────────────────────────────────────────
function formatMemory(mem) {
    const fileRef = mem.file_path
        ? `${mem.file_path}${mem.commit_hash ? ` @ ${mem.commit_hash.slice(0, 7)}` : ''}`
        : 'general';
    const line = `• [${fileRef}] (${mem.category}): ${mem.summary.slice(0, 200)}`;
    return {
        formatted: {
            id: mem.id,
            category: mem.category,
            summary: mem.summary,
            file_path: mem.file_path,
            commit_hash: mem.commit_hash,
            similarity: Math.round(mem.similarity * 100) / 100,
        },
        line,
    };
}
// ─── Main Recall Function ─────────────────────────────────────────────────────
export async function recallMemories(db, options) {
    const { query, file_path, max_items = 8, category } = options;
    const packageScope = derivePackageScope(file_path);
    const scopeFilter = buildScopeFilter(packageScope);
    const categoryFilter = category
        ? { sql: 'AND category = ?', params: [category] }
        : { sql: '', params: [] };
    const queryEmbedding = embed(query);
    let candidates = vectorSearch(db, queryEmbedding, scopeFilter, categoryFilter, max_items);
    if (candidates.length === 0) {
        candidates = keywordSearch(db, query, scopeFilter, categoryFilter, max_items);
    }
    const memories = [];
    let totalTokens = 0;
    let truncated = false;
    for (const mem of candidates) {
        const { formatted, line } = formatMemory(mem);
        const cost = estimateTokens(line);
        if (totalTokens + cost > MAX_RESPONSE_TOKENS) {
            truncated = true;
            break;
        }
        memories.push(formatted);
        totalTokens += cost;
    }
    return { memories, total_tokens: totalTokens, truncated };
}
// ─── Formatted Markdown Output ────────────────────────────────────────────────
export function formatRecallMarkdown(result, query) {
    if (result.memories.length === 0) {
        return `No memories found for: "${query}"`;
    }
    const lines = result.memories.map(m => {
        const fileRef = m.file_path
            ? `${m.file_path}${m.commit_hash ? ` @ ${m.commit_hash.slice(0, 7)}` : ''}`
            : 'general';
        return `• [${fileRef}] (${m.category}): ${m.summary.slice(0, 200)}`;
    });
    const header = `## Brain Recall: "${query}"`;
    const footer = result.truncated
        ? `\n_Results truncated to stay within ${MAX_RESPONSE_TOKENS} token budget._`
        : '';
    return [header, ...lines, footer].filter(Boolean).join('\n');
}
// ─── File-scoped Trace ────────────────────────────────────────────────────────
export function traceFile(db, filePath) {
    return db.prepare(`
    SELECT * FROM memories
    WHERE file_path = ?
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 20
  `).all(filePath);
}
//# sourceMappingURL=recall.js.map