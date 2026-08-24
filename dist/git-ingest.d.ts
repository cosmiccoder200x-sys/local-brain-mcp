/**
 * git-ingest.ts — Smart commit filter + ingestion pipeline.
 *
 * Reads git history, filters high-signal commits, generates local
 * embeddings, and stores them in the local SQLite brain DB.
 *
 * Solves the "git noise" problem:
 *  ✅ IGNORES: WIP, typo, temp, format, bump version, lint commits
 *  ✅ INCLUDES: fix:/feat:/refactor:, breaking changes (!), PR merges, bug/revert commits
 */
import Database from 'better-sqlite3';
export declare function isHighSignalCommit(message: string): boolean;
export interface IngestOptions {
    repoPath: string;
    maxCommits: number;
    dbPath?: string;
    since?: string;
    verbose?: boolean;
}
export interface IngestResult {
    scanned: number;
    ingested: number;
    skipped: number;
    errors: number;
}
export declare function ingestGitHistory(db: Database.Database, options: IngestOptions): Promise<IngestResult>;
export declare function ingestSingleCommit(db: Database.Database, repoPath: string, hash: string): Promise<boolean>;
//# sourceMappingURL=git-ingest.d.ts.map