/**
 * recall.ts — Multi-factor semantic recall engine with token-capped output.
 *
 * Ranking Strategy:
 *   FinalScore = (semantic_similarity * 0.60)
 *              + (importance * 0.15)
 *              + (freshness * 0.15)
 *              + (confidence * 0.10)
 *
 * Solves:
 *  ✅ Hard token budget cap per recall call
 *  ✅ Multi-factor ranking (semantic relevance + freshness + importance + confidence)
 *  ✅ Zero-latency in-memory vector dot product
 *  ✅ Fallback to keyword search if vector matches are sparse
 *  ✅ Monorepo package scoping applied automatically
 */

import Database from 'better-sqlite3';
import { embed, cosineSimilarity, estimateTokens } from './embeddings.js';
import { buildScopeFilter, derivePackageScope, sanitizeFilePath } from './scoping.js';
import type { Memory, MemoryCategory } from './db.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_RESPONSE_TOKENS = 250;
const FRESHNESS_HALF_LIFE_DAYS = 120; // 4-month half life for freshness decay

// Category baseline importance multipliers
const CATEGORY_IMPORTANCE_MAP: Record<MemoryCategory, number> = {
  architecture: 1.25,
  fix:          1.15,
  bug:          1.10,
  convention:   1.05,
  manual:       1.00,
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RecallOptions {
  query:       string;
  file_path?:  string;
  max_items?:  number;
  category?:   MemoryCategory;
  min_score?:  number;
}

export interface ScoredMemory extends Memory {
  similarity:  number; // raw cosine similarity [-1, 1]
  finalScore:  number; // multi-factor composite score [0, 1]
  freshness:   number; // freshness score [0, 1]
}

export interface FormattedMemory {
  id:          number;
  category:    string;
  summary:     string;
  file_path:   string | null;
  commit_hash: string | null;
  similarity:  number;
  finalScore:  number;
}

export interface RecallResult {
  memories:     FormattedMemory[];
  total_tokens: number;
  truncated:    boolean;
}

// ─── Ranking Math ─────────────────────────────────────────────────────────────

/**
 * Calculate freshness score [0, 1] based on exponential half-life decay.
 */
export function calculateFreshness(createdAt: string | undefined): number {
  if (!createdAt) return 0.7; // default neutral freshness
  const createdTime = new Date(createdAt).getTime();
  if (isNaN(createdTime)) return 0.7;

  const now = Date.now();
  const ageMs = Math.max(0, now - createdTime);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: e^(-ln(2) * age / halfLife)
  const decayRate = Math.LN2 / FRESHNESS_HALF_LIFE_DAYS;
  return Math.exp(-decayRate * ageDays);
}

/**
 * Compute transparent, deterministic composite score.
 */
export function computeFinalScore(
  rawSimilarity: number,
  category: MemoryCategory,
  createdAt: string,
  userImportance: number = 1.0,
  confidence: number = 1.0
): { finalScore: number; freshness: number; normalizedSim: number } {
  // Clamp raw cosine similarity to [0, 1]
  const normalizedSim = Math.max(0, Math.min(1, (rawSimilarity + 1) / 2));

  // Category & user importance normalized to [0, 1]
  const catMultiplier = CATEGORY_IMPORTANCE_MAP[category] ?? 1.0;
  const rawImportance = userImportance * catMultiplier;
  const normalizedImportance = Math.min(1.0, Math.max(0.1, rawImportance / 2.0));

  // Freshness decay
  const freshness = calculateFreshness(createdAt);

  // Confidence clamped
  const normalizedConfidence = Math.min(1.0, Math.max(0.1, confidence));

  // Multi-factor weighted score
  const finalScore =
    normalizedSim        * 0.60 +
    normalizedImportance * 0.15 +
    freshness            * 0.15 +
    normalizedConfidence * 0.10;

  return {
    finalScore: Math.round(finalScore * 1000) / 1000,
    freshness:  Math.round(freshness * 1000) / 1000,
    normalizedSim: Math.round(normalizedSim * 1000) / 1000,
  };
}

// ─── Vector Search ────────────────────────────────────────────────────────────

function vectorSearch(
  db: Database.Database,
  queryEmbedding: Float32Array,
  scopeFilter: { sql: string; params: string[] },
  categoryFilter: { sql: string; params: string[] },
  limit: number
): ScoredMemory[] {
  const sql = `
    SELECT *
    FROM memories
    WHERE status = 'active'
      ${scopeFilter.sql}
      ${categoryFilter.sql}
  `;

  const rows = db.prepare(sql).all(
    ...scopeFilter.params,
    ...categoryFilter.params
  ) as Memory[];

  const scored: ScoredMemory[] = [];

  for (const row of rows) {
    let similarity = 0.5;

    if (row.embedding && row.embedding.length > 0) {
      const buf = row.embedding;
      const memVec = new Float32Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      similarity = cosineSimilarity(queryEmbedding, memVec);
    }

    const { finalScore, freshness } = computeFinalScore(
      similarity,
      row.category,
      row.created_at,
      row.importance,
      row.confidence
    );

    scored.push({
      ...row,
      similarity,
      finalScore,
      freshness,
    });
  }

  // Rank by composite score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored.slice(0, limit);
}

// ─── Keyword Search Fallback ──────────────────────────────────────────────────

function keywordSearch(
  db: Database.Database,
  query: string,
  scopeFilter: { sql: string; params: string[] },
  categoryFilter: { sql: string; params: string[] },
  limit: number
): ScoredMemory[] {
  const words = query
    .split(/\s+/)
    .map(w => w.replace(/[%_]/g, ''))
    .filter(w => w.length >= 2);

  if (words.length === 0) return [];

  const pattern = `%${words.slice(0, 3).join('%')}%`;

  const sql = `
    SELECT *
    FROM memories
    WHERE status = 'active'
      AND (content LIKE ? OR summary LIKE ?)
      ${scopeFilter.sql}
      ${categoryFilter.sql}
    ORDER BY created_at DESC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(
    pattern,
    pattern,
    ...scopeFilter.params,
    ...categoryFilter.params,
    limit
  ) as Memory[];

  return rows.map(row => {
    const { finalScore, freshness } = computeFinalScore(
      0.3, // default keyword baseline similarity
      row.category,
      row.created_at,
      row.importance,
      row.confidence
    );
    return {
      ...row,
      similarity: 0.3,
      finalScore,
      freshness,
    };
  });
}

// ─── Formatter ────────────────────────────────────────────────────────────────

function formatMemory(mem: ScoredMemory): {
  formatted: FormattedMemory;
  line: string;
} {
  const fileRef = mem.file_path
    ? `${mem.file_path}${mem.commit_hash ? ` @ ${mem.commit_hash.slice(0, 7)}` : ''}`
    : 'general';

  const summary = (mem.summary || mem.content || '').slice(0, 250).trim();
  const line = `• [${fileRef}] (${mem.category}): ${summary}`;

  return {
    formatted: {
      id:          mem.id,
      category:    mem.category,
      summary,
      file_path:   mem.file_path,
      commit_hash: mem.commit_hash,
      similarity:  Math.round(mem.similarity * 100) / 100,
      finalScore:  Math.round(mem.finalScore * 100) / 100,
    },
    line,
  };
}

// ─── Main Recall ──────────────────────────────────────────────────────────────

export async function recallMemories(
  db: Database.Database,
  options: RecallOptions
): Promise<RecallResult> {
  const { query, file_path, max_items = 5, category, min_score = 0.25 } = options;

  const sanitizedPath = sanitizeFilePath(file_path);
  const packageScope  = derivePackageScope(sanitizedPath);
  const scopeFilter   = buildScopeFilter(packageScope);

  const categoryFilter = category
    ? { sql: 'AND category = ?', params: [category] }
    : { sql: '', params: [] };

  const queryEmbedding = embed(query);

  let candidates = vectorSearch(
    db, queryEmbedding, scopeFilter, categoryFilter, max_items
  );

  // If vector search returned very few results, supplement with keyword search
  if (candidates.length < max_items) {
    const keywordCandidates = keywordSearch(
      db, query, scopeFilter, categoryFilter, max_items - candidates.length
    );
    const seenIds = new Set(candidates.map(c => c.id));
    for (const kw of keywordCandidates) {
      if (!seenIds.has(kw.id)) {
        candidates.push(kw);
        seenIds.add(kw.id);
      }
    }
  }

  // Filter below minimum score threshold
  const filtered = candidates.filter(c => c.finalScore >= min_score);

  const memories: FormattedMemory[] = [];
  let totalTokens = 0;
  let truncated = false;

  for (const mem of filtered) {
    const { formatted, line } = formatMemory(mem);
    const cost = estimateTokens(line);

    if (totalTokens + cost > MAX_RESPONSE_TOKENS && memories.length > 0) {
      truncated = true;
      break;
    }

    memories.push(formatted);
    totalTokens += cost;
  }

  return { memories, total_tokens: totalTokens, truncated };
}

// ─── Markdown Output ──────────────────────────────────────────────────────────

export function formatRecallMarkdown(result: RecallResult, query: string): string {
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

// ─── File Trace ───────────────────────────────────────────────────────────────

export function traceFile(
  db: Database.Database,
  filePath: string
): Memory[] {
  const sanitized = sanitizeFilePath(filePath);
  if (!sanitized) return [];

  return db.prepare(`
    SELECT * FROM memories
    WHERE file_path = ?
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'stale' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 25
  `).all(sanitized) as Memory[];
}
