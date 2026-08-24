/**
 * db.ts — Database initialization, connection management, and migrations.
 *
 * Uses better-sqlite3 for synchronous SQLite access. Vector embeddings are
 * stored directly as Float32Array BLOBs for fast zero-dependency local search.
 */
import Database from 'better-sqlite3';
export declare function resolveDbPath(repoRoot?: string): string;
export type MemoryCategory = 'fix' | 'architecture' | 'convention' | 'bug' | 'manual';
export type MemoryStatus = 'active' | 'stale' | 'deprecated';
export type MemorySource = 'git-ingest' | 'manual' | 'session';
export interface Memory {
    id: number;
    category: MemoryCategory;
    content: string;
    summary: string;
    file_path: string | null;
    package_scope: string | null;
    commit_hash: string | null;
    git_ref: string | null;
    status: MemoryStatus;
    source: MemorySource;
    token_count: number;
    embedding: Buffer | null;
    created_at: string;
    updated_at: string;
}
export interface FileSnapshot {
    id: number;
    file_path: string;
    commit_hash: string;
    line_count: number;
    updated_at: string;
}
export declare function getDb(dbPath?: string): Database.Database;
export declare function insertMemory(db: Database.Database, fields: Omit<Memory, 'id' | 'created_at' | 'updated_at' | 'embedding'>, embedding?: Float32Array): number;
export declare function insertEmbedding(db: Database.Database, id: number, embedding: Float32Array): void;
export declare function markMemoryStale(db: Database.Database, id: number): void;
export declare function markMemoryDeprecated(db: Database.Database, id: number): void;
export declare function getActiveMemoriesByFile(db: Database.Database, filePath: string): Memory[];
export declare function pruneByStatus(db: Database.Database, status: MemoryStatus | 'all'): number;
export declare function upsertFileSnapshot(db: Database.Database, filePath: string, commitHash: string, lineCount: number): void;
export declare function getFileSnapshot(db: Database.Database, filePath: string): FileSnapshot | null;
export declare function isCommitIngested(db: Database.Database, hash: string): boolean;
export declare function markCommitIngested(db: Database.Database, hash: string, count: number): void;
//# sourceMappingURL=db.d.ts.map