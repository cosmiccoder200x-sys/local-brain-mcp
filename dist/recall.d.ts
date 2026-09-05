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
import type { Memory, MemoryCategory } from './db.js';
export declare const MAX_RESPONSE_TOKENS = 250;
export interface RecallOptions {
    query: string;
    file_path?: string;
    max_items?: number;
    category?: MemoryCategory;
    min_score?: number;
}
export interface ScoredMemory extends Memory {
    similarity: number;
    finalScore: number;
    freshness: number;
}
export interface FormattedMemory {
    id: number;
    category: string;
    summary: string;
    file_path: string | null;
    commit_hash: string | null;
    similarity: number;
    finalScore: number;
}
export interface RecallResult {
    memories: FormattedMemory[];
    total_tokens: number;
    truncated: boolean;
}
/**
 * Calculate freshness score [0, 1] based on exponential half-life decay.
 */
export declare function calculateFreshness(createdAt: string | undefined): number;
/**
 * Compute transparent, deterministic composite score.
 */
export declare function computeFinalScore(rawSimilarity: number, category: MemoryCategory, createdAt: string, userImportance?: number, confidence?: number): {
    finalScore: number;
    freshness: number;
    normalizedSim: number;
};
export declare function recallMemories(db: Database.Database, options: RecallOptions): Promise<RecallResult>;
export declare function formatRecallMarkdown(result: RecallResult, query: string): string;
export declare function traceFile(db: Database.Database, filePath: string): Memory[];
//# sourceMappingURL=recall.d.ts.map