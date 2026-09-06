/**
 * invalidation.ts — Stale memory detection and auto-invalidation engine.
 *
 * Binds each memory to a git commit hash. When the associated file is
 * rewritten (>30% line changes) or deleted since the memory was recorded,
 * the memory is automatically marked as STALE so it stops appearing in recalls.
 */
import { getActiveMemoriesByFile, getFileSnapshot, markMemoryStale, upsertFileSnapshot, } from './db.js';
// ─── Threshold ────────────────────────────────────────────────────────────────
/** If a file changes more than this fraction since the memory was stored, invalidate. */
export const STALE_CHANGE_THRESHOLD = 0.30; // 30%
// ─── Line-diff Calculator ─────────────────────────────────────────────────────
/**
 * Count insertions and deletions in a git diff output string.
 */
export function parseDiffStats(diffOutput) {
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
 *
 * @param git        simple-git instance
 * @param filePath   repo-relative file path
 * @param oldHash    the commit when the memory was stored
 * @param newHash    current HEAD (or 'HEAD')
 * @param baseline   the line count of the file at oldHash
 * @returns          true if the file should be considered stale
 */
export async function isFileStale(git, filePath, oldHash, newHash, baseline) {
    try {
        const diff = await git.diff([oldHash, newHash, '--', filePath]);
        if (!diff.trim())
            return false; // no change
        const { added, removed } = parseDiffStats(diff);
        const totalChanges = added + removed;
        const changeRatio = baseline > 0 ? totalChanges / baseline : 1.0;
        return changeRatio >= STALE_CHANGE_THRESHOLD;
    }
    catch {
        // If git diff fails (e.g. file deleted or commit gone), treat as stale
        return true;
    }
}
// ─── Current Line Count ───────────────────────────────────────────────────────
export async function getCurrentLineCount(git, filePath, headHash) {
    try {
        const content = await git.show([`${headHash}:${filePath}`]);
        return content.split('\n').length;
    }
    catch {
        return 0; // file deleted or not found
    }
}
/**
 * Scan all active memories, check their associated files for staleness,
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
    SELECT DISTINCT file_path, files, commit_hash
    FROM memories
    WHERE status = 'active' AND commit_hash IS NOT NULL
  `).all();
    const checkedPaths = new Set();
    for (const row of rows) {
        const candidateFiles = [];
        if (row.file_path)
            candidateFiles.push(row.file_path);
        if (row.files) {
            try {
                const parsed = JSON.parse(row.files);
                if (Array.isArray(parsed)) {
                    for (const f of parsed) {
                        if (typeof f === 'string' && !candidateFiles.includes(f)) {
                            candidateFiles.push(f);
                        }
                    }
                }
            }
            catch { /* ignore */ }
        }
        for (const filePath of candidateFiles) {
            if (checkedPaths.has(filePath))
                continue;
            checkedPaths.add(filePath);
            result.checkedFiles++;
            if (row.commit_hash === headHash)
                continue; // memory is current
            const snapshot = getFileSnapshot(db, filePath);
            const baseline = snapshot?.line_count ?? 0;
            const stale = await isFileStale(git, filePath, row.commit_hash, headHash, baseline);
            if (stale) {
                const memories = getActiveMemoriesByFile(db, filePath);
                for (const mem of memories) {
                    markMemoryStale(db, mem.id);
                    result.stalifiedCount++;
                }
            }
            // Update snapshot with current state
            const lineCount = await getCurrentLineCount(git, filePath, headHash);
            upsertFileSnapshot(db, filePath, headHash, lineCount);
            result.updatedSnapshots++;
        }
    }
    return result;
}
/**
 * Invalidate memories for a single file.
 */
export async function invalidateFile(db, git, filePath) {
    let headHash;
    try {
        headHash = (await git.revparse(['HEAD'])).trim();
    }
    catch {
        return 0;
    }
    const snapshot = getFileSnapshot(db, filePath);
    if (!snapshot)
        return 0;
    const stale = await isFileStale(git, filePath, snapshot.commit_hash, headHash, snapshot.line_count);
    if (!stale)
        return 0;
    const memories = getActiveMemoriesByFile(db, filePath);
    for (const mem of memories) {
        markMemoryStale(db, mem.id);
    }
    return memories.length;
}
//# sourceMappingURL=invalidation.js.map