/**
 * invalidation.ts — Stale memory detection and auto-invalidation engine.
 *
 * Binds each memory to a git commit hash. When the associated file is
 * rewritten (>30% line changes) since the memory was recorded, the
 * memory is automatically marked as STALE so it stops appearing in recalls.
 */
import Database from 'better-sqlite3';
import type { SimpleGit } from 'simple-git';
/** If a file changes more than this fraction since the memory was stored, invalidate. */
export declare const STALE_CHANGE_THRESHOLD = 0.3;
/**
 * Count insertions and deletions in a git diff output string.
 */
export declare function parseDiffStats(diffOutput: string): {
    added: number;
    removed: number;
};
/**
 * Check whether a specific file has changed beyond the stale threshold
 * between two git commits.
 */
export declare function isFileStale(git: SimpleGit, filePath: string, oldHash: string, newHash: string, baseline: number): Promise<boolean>;
export declare function getCurrentLineCount(git: SimpleGit, filePath: string, headHash: string): Promise<number>;
export interface InvalidationResult {
    checkedFiles: number;
    stalifiedCount: number;
    updatedSnapshots: number;
}
/**
 * Scan all active memories, check their associated file for staleness,
 * and mark outdated memories as STALE.
 */
export declare function runInvalidationPass(db: Database.Database, git: SimpleGit): Promise<InvalidationResult>;
/**
 * Invalidate memories for a single file.
 */
export declare function invalidateFile(db: Database.Database, git: SimpleGit, filePath: string): Promise<number>;
//# sourceMappingURL=invalidation.d.ts.map