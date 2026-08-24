/**
 * invalidation.ts — Stale memory detection and auto-invalidation engine.
 *
 * Binds each memory to a git commit hash. When the associated file is
 * rewritten (>30% line changes) since the memory was recorded, the
 * memory is automatically marked as STALE so it stops appearing in recalls.
 */

import Database from 'better-sqlite3';
import type { SimpleGit } from 'simple-git';
import {
  getActiveMemoriesByFile,
  getFileSnapshot,
  markMemoryStale,
  upsertFileSnapshot,
  type Memory,
} from './db.js';

// ─── Threshold ────────────────────────────────────────────────────────────────

/** If a file changes more than this fraction since the memory was stored, invalidate. */
const STALE_CHANGE_THRESHOLD = 0.30; // 30%

// ─── Line-diff Calculator ─────────────────────────────────────────────────────

/**
 * Count insertions and deletions in a git diff output string.
 */
function parseDiffStats(diffOutput: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

/**
 * Check whether a specific file has changed beyond the stale threshold
 * between two git commits.
 *
 * @param git        simple-git instance
 * @param filePath   repo-relative file path
 * @param oldHash    the commit when the memory was stored
 * @param newHash    current HEAD (or 'HEAD')
 * @param baseline   the line count of the file at oldHash
 * @returns          true if the file should be considered stale
 */
async function isFileStale(
  git: SimpleGit,
  filePath: string,
  oldHash: string,
  newHash: string,
  baseline: number
): Promise<boolean> {
  try {
    const diff = await git.diff([oldHash, newHash, '--', filePath]);
    if (!diff.trim()) return false;  // no change

    const { added, removed } = parseDiffStats(diff);
    const totalChanges = added + removed;
    const changeRatio = baseline > 0 ? totalChanges / baseline : 0;

    return changeRatio >= STALE_CHANGE_THRESHOLD;
  } catch {
    // If git diff fails (e.g. file deleted), treat as stale
    return true;
  }
}

// ─── Current Line Count ───────────────────────────────────────────────────────

async function getCurrentLineCount(
  git: SimpleGit,
  filePath: string,
  headHash: string
): Promise<number> {
  try {
    const content = await git.show([`${headHash}:${filePath}`]);
    return content.split('\n').length;
  } catch {
    return 0; // file deleted
  }
}

// ─── Main Invalidation Run ────────────────────────────────────────────────────

export interface InvalidationResult {
  checkedFiles:    number;
  stalifiedCount:  number;
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
export async function runInvalidationPass(
  db: Database.Database,
  git: SimpleGit
): Promise<InvalidationResult> {
  const result: InvalidationResult = {
    checkedFiles:     0,
    stalifiedCount:   0,
    updatedSnapshots: 0,
  };

  let headHash: string;
  try {
    headHash = (await git.revparse(['HEAD'])).trim();
  } catch {
    // Not a git repo or no commits yet
    return result;
  }

  // Collect unique file paths with active memories
  const rows = db.prepare(`
    SELECT DISTINCT file_path, commit_hash
    FROM memories
    WHERE status = 'active' AND file_path IS NOT NULL AND commit_hash IS NOT NULL
  `).all() as Array<{ file_path: string; commit_hash: string }>;

  const checkedPaths = new Set<string>();

  for (const { file_path, commit_hash } of rows) {
    if (checkedPaths.has(file_path)) continue;
    checkedPaths.add(file_path);
    result.checkedFiles++;

    if (commit_hash === headHash) continue; // memory is current

    const snapshot = getFileSnapshot(db, file_path);
    const baseline  = snapshot?.line_count ?? 0;

    const stale = await isFileStale(git, file_path, commit_hash, headHash, baseline);

    if (stale) {
      // Mark all active memories for this file as stale
      const memories = getActiveMemoriesByFile(db, file_path);
      for (const mem of memories) {
        markMemoryStale(db, mem.id);
        result.stalifiedCount++;
      }
    }

    // Update snapshot with current state
    const lineCount = await getCurrentLineCount(git, file_path, headHash);
    upsertFileSnapshot(db, file_path, headHash, lineCount);
    result.updatedSnapshots++;
  }

  return result;
}

/**
 * Invalidate memories for a single file.
 * Used during post-commit hook execution.
 */
export async function invalidateFile(
  db: Database.Database,
  git: SimpleGit,
  filePath: string
): Promise<number> {
  let headHash: string;
  try {
    headHash = (await git.revparse(['HEAD'])).trim();
  } catch {
    return 0;
  }

  const snapshot = getFileSnapshot(db, filePath);
  if (!snapshot) return 0;

  const stale = await isFileStale(
    git,
    filePath,
    snapshot.commit_hash,
    headHash,
    snapshot.line_count
  );

  if (!stale) return 0;

  const memories = getActiveMemoriesByFile(db, filePath);
  for (const mem of memories) {
    markMemoryStale(db, mem.id);
  }
  return memories.length;
}
