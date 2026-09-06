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
import Database from 'better-sqlite3';
import type { Memory, MemoryCategory } from './db.js';
export declare const MAX_RESPONSE_TOKENS = 250;
export interface RecallOptions {
    query: string;
    file_path?: string;
    max_items?: number;
    category?: MemoryCategory;
    include_deprecated?: boolean;
    min_confidence?: number;
}
export interface RecallResult {
    memories: FormattedMemory[];
    total_tokens: number;
    truncated: boolean;
    query: string;
}
export interface FormattedMemory {
    id: number;
    category: string;
    summary: string;
    file_path: string | null;
    files: string[];
    commit_hash: string | null;
    author: string | null;
    confidence: number;
    importance: number;
    status: string;
    similarity: number;
    rank_score: number;
    superseded_by: number | null;
}
export interface ScoredMemory extends Memory {
    similarity: number;
    scopeScore: number;
    recencyScore: number;
    rankScore: number;
}
/**
 * Computes composite deterministic rank score for a candidate memory.
 */
export declare function computeRankScore(mem: Memory, similarity: number, targetFile?: string, targetPackageScope?: string | null): ScoredMemory;
export declare function recallMemories(db: Database.Database, options: RecallOptions): Promise<RecallResult>;
export declare function formatRecallMarkdown(result: RecallResult, query: string): string;
export declare function traceFile(db: Database.Database, filePath: string): Memory[];
//# sourceMappingURL=recall.d.ts.map