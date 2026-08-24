/**
 * invalidation.ts — Stale memory detection and auto-invalidation engine.
 *
 * Binds each memory to a git commit hash. When the associated file is
 * rewritten (>30% line changes) since the memory was recorded, the
 * memory is automatically marked as STALE so it stops appearing in recalls.
 */
import Database from 'better-sqlite3';
import type { SimpleGit } from 'simple-git';
export interface InvalidationResult {
    checkedFiles: number;
    stalifiedCount: number;
    updatedSnapshots: number;
}
/**
 * Scan all active memories, check their associated file for staleness,
 * and mark outdated memories as STALE.
 *
 * Call this:
 * - After each `git-ingest` run
 * - Via the `brain_prune` MCP tool on demand
 */
export declare function runInvalidationPass(db: Database.Database, git: SimpleGit): Promise<InvalidationResult>;
/**
 * Invalidate memories for a single file.
 * Used during post-commit hook execution.
 */
export declare function invalidateFile(db: Database.Database, git: SimpleGit, filePath: string): Promise<number>;
//# sourceMappingURL=invalidation.d.ts.map