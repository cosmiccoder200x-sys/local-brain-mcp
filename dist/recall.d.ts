/**
 * recall.ts — Token-capped semantic recall engine.
 *
 * Solves the "token bloat" problem:
 *  ✅ Hard cap of MAX_RESPONSE_TOKENS per recall call
 *  ✅ In-memory cosine similarity search (sub-1ms local)
 *  ✅ Fallback to keyword search if vector matches are below threshold
 *  ✅ Monorepo package scoping applied automatically
 */
import Database from 'better-sqlite3';
import type { Memory, MemoryCategory } from './db.js';
export interface RecallOptions {
    query: string;
    file_path?: string;
    max_items?: number;
    category?: MemoryCategory;
}
export interface RecallResult {
    memories: FormattedMemory[];
    total_tokens: number;
    truncated: boolean;
}
export interface FormattedMemory {
    id: number;
    category: string;
    summary: string;
    file_path: string | null;
    commit_hash: string | null;
    similarity: number;
}
export declare function recallMemories(db: Database.Database, options: RecallOptions): Promise<RecallResult>;
export declare function formatRecallMarkdown(result: RecallResult, query: string): string;
export declare function traceFile(db: Database.Database, filePath: string): Memory[];
//# sourceMappingURL=recall.d.ts.map