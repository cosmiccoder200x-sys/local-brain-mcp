/**
 * db.ts — Database initialization, connection management, migrations, and CRUD operations.
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
    files: string | null;
    package_scope: string | null;
    commit_hash: string | null;
    git_ref: string | null;
    author: string | null;
    branch: string | null;
    project: string | null;
    confidence: number;
    importance: number;
    quality_score: number;
    status: MemoryStatus;
    source: MemorySource;
    superseded_by: number | null;
    supersedes_id: number | null;
    last_validated: string | null;
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
export interface DbStats {
    total: number;
    active: number;
    stale: number;
    deprecated: number;
    from_git: number;
    manual: number;
    superseded: number;
    commits_ingested: number;
    file_snapshots: number;
}
/**
 * Idempotent migration to ensure older databases receive Phase 2/3 schema columns
 * without data loss or table recreation.
 */
export declare function migrateDb(db: Database.Database): void;
export declare const BASE_SCHEMA_SQL = "\n-- ============================================================\n-- local-brain-mcp: Pure SQLite schema with BLOB vector storage\n-- ============================================================\n\nPRAGMA journal_mode = WAL;\nPRAGMA foreign_keys = ON;\n\nCREATE TABLE IF NOT EXISTS memories (\n  id             INTEGER PRIMARY KEY AUTOINCREMENT,\n  category       TEXT NOT NULL CHECK(category IN ('fix', 'architecture', 'convention', 'bug', 'manual')),\n  content        TEXT NOT NULL,\n  summary        TEXT NOT NULL,\n  file_path      TEXT,\n  files          TEXT,\n  package_scope  TEXT,\n  commit_hash    TEXT,\n  git_ref        TEXT,\n  author         TEXT,\n  branch         TEXT,\n  project        TEXT,\n  confidence     REAL NOT NULL DEFAULT 1.0,\n  importance     REAL NOT NULL DEFAULT 1.0,\n  quality_score  REAL NOT NULL DEFAULT 1.0,\n  status         TEXT NOT NULL DEFAULT 'active'\n                      CHECK(status IN ('active', 'stale', 'deprecated')),\n  source         TEXT DEFAULT 'git-ingest'\n                      CHECK(source IN ('git-ingest', 'manual', 'session')),\n  superseded_by  INTEGER REFERENCES memories(id) ON DELETE SET NULL,\n  supersedes_id  INTEGER REFERENCES memories(id) ON DELETE SET NULL,\n  last_validated DATETIME DEFAULT CURRENT_TIMESTAMP,\n  token_count    INTEGER DEFAULT 0,\n  embedding      BLOB,\n  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,\n  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE INDEX IF NOT EXISTS idx_memories_status        ON memories(status);\nCREATE INDEX IF NOT EXISTS idx_memories_file_path     ON memories(file_path);\nCREATE INDEX IF NOT EXISTS idx_memories_package       ON memories(package_scope);\nCREATE INDEX IF NOT EXISTS idx_memories_category      ON memories(category);\nCREATE INDEX IF NOT EXISTS idx_memories_commit        ON memories(commit_hash);\nCREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by);\nCREATE INDEX IF NOT EXISTS idx_memories_branch        ON memories(branch);\nCREATE INDEX IF NOT EXISTS idx_memories_project       ON memories(project);\n\nCREATE TRIGGER IF NOT EXISTS memories_updated_at\n  AFTER UPDATE ON memories\n  BEGIN\n    UPDATE memories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;\n  END;\n\nCREATE TABLE IF NOT EXISTS file_snapshots (\n  id            INTEGER PRIMARY KEY AUTOINCREMENT,\n  file_path     TEXT NOT NULL UNIQUE,\n  commit_hash   TEXT NOT NULL,\n  line_count    INTEGER DEFAULT 0,\n  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE INDEX IF NOT EXISTS idx_snapshots_file ON file_snapshots(file_path);\n\nCREATE TABLE IF NOT EXISTS ingested_commits (\n  commit_hash   TEXT PRIMARY KEY,\n  ingested_at   DATETIME DEFAULT CURRENT_TIMESTAMP,\n  memory_count  INTEGER DEFAULT 0\n);\n";
export declare function getDb(dbPath?: string): Database.Database;
export declare function closeDb(): void;
export type InsertMemoryInput = Partial<Omit<Memory, 'id' | 'created_at' | 'updated_at' | 'embedding'>> & {
    category: MemoryCategory;
    content: string;
    summary: string;
};
export declare function insertMemory(db: Database.Database, fields: InsertMemoryInput, embedding?: Float32Array): number;
export declare function insertEmbedding(db: Database.Database, id: number, embedding: Float32Array): void;
export declare function getMemoryById(db: Database.Database, id: number): Memory | null;
export declare function updateMemory(db: Database.Database, id: number, fields: Partial<Omit<Memory, 'id' | 'created_at' | 'updated_at' | 'embedding'>>): boolean;
export declare function supersedeMemory(db: Database.Database, oldId: number, newId: number): void;
export declare function markMemoryStale(db: Database.Database, id: number): void;
export declare function markMemoryDeprecated(db: Database.Database, id: number): void;
export declare function getActiveMemoriesByFile(db: Database.Database, filePath: string): Memory[];
export declare function pruneByStatus(db: Database.Database, status: MemoryStatus | 'all'): number;
export interface ForgetOptions {
    id?: number;
    filePath?: string;
    query?: string;
    hardDelete?: boolean;
}
export declare function forgetMemory(db: Database.Database, options: ForgetOptions): {
    count: number;
    affectedIds: number[];
};
export interface DuplicateMatch {
    match: Memory;
    similarity: number;
    isExact: boolean;
}
/**
 * Searches for exact or near-duplicate memories in the database.
 * Returns the highest matching memory if similarity threshold is met.
 */
export declare function findDuplicateMemory(db: Database.Database, embedding: Float32Array | null, content: string, filePath?: string | null, similarityThreshold?: number): DuplicateMatch | null;
/**
 * Merges new knowledge into an existing memory record, preserving the richest context.
 */
export declare function mergeMemory(db: Database.Database, existingId: number, newFields: InsertMemoryInput): void;
export declare function getDbStats(db: Database.Database): DbStats;
export declare function upsertFileSnapshot(db: Database.Database, filePath: string, commitHash: string, lineCount: number): void;
export declare function getFileSnapshot(db: Database.Database, filePath: string): FileSnapshot | null;
export declare function isCommitIngested(db: Database.Database, hash: string): boolean;
export declare function markCommitIngested(db: Database.Database, hash: string, count: number): void;
//# sourceMappingURL=db.d.ts.map