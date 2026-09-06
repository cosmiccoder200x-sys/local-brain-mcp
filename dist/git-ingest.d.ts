/**
 * git-ingest.ts — Smart commit filter + ingestion pipeline with provenance.
 *
 * Reads git history, filters high-signal commits, extracts rich provenance,
 * generates local embeddings, and stores them in the local SQLite brain DB.
 *
 * Solves the "git noise" problem:
 *  ✅ IGNORES: WIP, typo, temp, format, bump version, lint commits
 *  ✅ INCLUDES: fix:/feat:/refactor:, breaking changes (!), PR merges, bug/revert commits
 *  ✅ EXTRACTS: author, branch, changed files list, confidence & importance ratings
 *  ✅ DEDUPLICATES: detects duplicate knowledge and merges provenance cleanly
 */
import Database from 'better-sqlite3';
import { type MemoryCategory } from './db.js';
export declare function inferCategory(message: string): MemoryCategory;
export declare function inferImportance(message: string): number;
interface CommitData {
    hash: string;
    message: string;
    diff: string;
    files: string[];
    ref: string;
}
/**
 * Build a compact plain-English summary of a commit suitable for embedding.
 */
export declare function buildCommitSummary(commit: CommitData): string;
export declare function isHighSignalCommit(message: string): boolean;
export interface IngestOptions {
    repoPath: string;
    maxCommits?: number;
    dbPath?: string;
    since?: string;
    verbose?: boolean;
    project?: string;
}
export interface IngestResult {
    scanned: number;
    ingested: number;
    skipped: number;
    merged: number;
    errors: number;
}
export declare function ingestGitHistory(db: Database.Database, options: IngestOptions): Promise<IngestResult>;
export declare function ingestSingleCommit(db: Database.Database, repoPath: string, hash: string): Promise<boolean>;
export {};
//# sourceMappingURL=git-ingest.d.ts.map