/**
 * invalidation.ts — Stale memory detection and auto-invalidation engine.
 *
 * Binds each memory to a git commit hash. When the associated file is
 * rewritten (>30% line changes) since the memory was recorded, the
 * memory is automatically marked as STALE so it stops appearing in recalls.
 */
import { getActiveMemoriesByFile, getFileSnapshot, markMemoryStale, upsertFileSnapshot, } from './db.js';
import { sanitizeFilePath } from './scoping.js';
// ─── Threshold ────────────────────────────────────────────────────────────────
/** If a file changes more than this fraction since the memory was stored, invalidate. */
export const STALE_CHANGE_THRESHOLD = 0.30; // 30%
// ─── Line-diff Calculator ─────────────────────────────────────────────────────
/**
 * Count insertions and deletions in a git diff output string.
 */
export function parseDiffStats(diffOutput) {
    if (!diffOutput)
        return { added: 0, removed: 0 };
    let added = 0;
    let removed = 0;
    for (const line of diffOutput.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++'))
            added++;
        if (line.startsWith('-') && !line.startsWith('---'))
            removed++;
    }
    return { added, removed };
}
/**
 * Check whether a specific file has changed beyond the stale threshold
 * between two git commits.
 */
export async function isFileStale(git, filePath, oldHash, newHash, baseline) {
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return true;
    try {
        const diff = await git.diff([oldHash, newHash, '--', sanitized]);
        if (!diff.trim())
            return false; // no change
        const { added, removed } = parseDiffStats(diff);
        const totalChanges = added + removed;
        const changeRatio = baseline > 0 ? totalChanges / baseline : 0;
        return changeRatio >= STALE_CHANGE_THRESHOLD;
    }
    catch {
        // If git diff fails (e.g. file deleted or commit missing), treat as stale
        return true;
    }
}
// ─── Current Line Count ───────────────────────────────────────────────────────
export async function getCurrentLineCount(git, filePath, headHash) {
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return 0;
    try {
        const content = await git.show([`${headHash}:${sanitized}`]);
        return content.split('\n').length;
    }
    catch {
        return 0; // file deleted or not present at HEAD
    }
}
/**
 * Scan all active memories, check their associated file for staleness,
 * and mark outdated memories as STALE.
 */
export async function runInvalidationPass(db, git) {
    const result = {
        checkedFiles: 0,
        stalifiedCount: 0,
        updatedSnapshots: 0,
    };
    let headHash;
    try {
        headHash = (await git.revparse(['HEAD'])).trim();
    }
    catch {
        // Not a git repo or no commits yet
        return result;
    }
    // Collect unique file paths with active memories
    const rows = db.prepare(`
    SELECT DISTINCT file_path, commit_hash
    FROM memories
    WHERE status = 'active' AND file_path IS NOT NULL AND commit_hash IS NOT NULL
  `).all();
    const checkedPaths = new Set();
    for (const { file_path, commit_hash } of rows) {
        if (!file_path || checkedPaths.has(file_path))
            continue;
        checkedPaths.add(file_path);
        result.checkedFiles++;
        if (commit_hash === headHash)
            continue; // memory is current
        const snapshot = getFileSnapshot(db, file_path);
        const baseline = snapshot?.line_count ?? 0;
        const stale = await isFileStale(git, file_path, commit_hash, headHash, baseline);
        if (stale) {
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
 */
export async function invalidateFile(db, git, filePath) {
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return 0;
    let headHash;
    try {
        headHash = (await git.revparse(['HEAD'])).trim();
    }
    catch {
        return 0;
    }
    const snapshot = getFileSnapshot(db, sanitized);
    if (!snapshot)
        return 0;
    const stale = await isFileStale(git, sanitized, snapshot.commit_hash, headHash, snapshot.line_count);
    if (!stale)
        return 0;
    const memories = getActiveMemoriesByFile(db, sanitized);
    for (const mem of memories) {
        markMemoryStale(db, mem.id);
    }
    return memories.length;
}
//# sourceMappingURL=invalidation.js.map