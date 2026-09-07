/**
 * invalidation.ts — Stale memory detection and auto-invalidation engine.
 *
 * Binds each memory to a git commit hash. When the associated file is
 * rewritten (>30% line changes) or deleted since the memory was recorded,
 * the memory is automatically marked as STALE so it stops appearing in recalls.
 */
import { getActiveMemoriesByFile, getFileSnapshot, markMemoryStale, upsertFileSnapshot, } from "./db.js";
import { sanitizeFilePath } from "./scoping.js";
import { STALE_CHANGE_THRESHOLD } from "./config.js";
import { debugLog } from "./debug.js";
// Re-export for backward compatibility with tests
export { STALE_CHANGE_THRESHOLD } from "./config.js";
// ─── Line-diff Calculator ─────────────────────────────────────────────────────
/**
 * Count insertions and deletions in a git diff output string.
 */
export function parseDiffStats(diffOutput) {
    let added = 0;
    let removed = 0;
    for (const line of diffOutput.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++"))
            added++;
        if (line.startsWith("-") && !line.startsWith("---"))
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
        const diff = await git.diff([oldHash, newHash, "--", sanitized]);
        if (!diff.trim())
            return false; // no change
        const { added, removed } = parseDiffStats(diff);
        const totalChanges = added + removed;
        const changeRatio = baseline > 0 ? totalChanges / baseline : 1.0;
        return changeRatio >= STALE_CHANGE_THRESHOLD;
    }
    catch (e) {
        debugLog("invalidation", "Git diff failed for %s: %s", filePath, e instanceof Error ? e.message : String(e));
        // If git diff fails (e.g. file deleted or commit gone), treat as stale
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
        return content.split("\n").length;
    }
    catch (e) {
        debugLog("invalidation", "Failed to get line count for %s: %s", filePath, e instanceof Error ? e.message : String(e));
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
        headHash = (await git.revparse(["HEAD"])).trim();
    }
    catch (e) {
        debugLog("invalidation", "Failed to get HEAD hash: %s", e instanceof Error ? e.message : String(e));
        // Not a git repo or no commits yet
        return result;
    }
    // Collect unique file paths with active memories
    const rows = db
        .prepare(`
    SELECT DISTINCT file_path, files, commit_hash
    FROM memories
    WHERE status = 'active' AND commit_hash IS NOT NULL
  `)
        .all();
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
                        if (typeof f === "string" && !candidateFiles.includes(f)) {
                            candidateFiles.push(f);
                        }
                    }
                }
            }
            catch (e) {
                debugLog("invalidation", "Failed to parse files JSON: %s", e instanceof Error ? e.message : String(e));
            }
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
    const sanitized = sanitizeFilePath(filePath);
    if (!sanitized)
        return 0;
    let headHash;
    try {
        headHash = (await git.revparse(["HEAD"])).trim();
    }
    catch (e) {
        debugLog("invalidation", "Failed to get HEAD hash in invalidateFile: %s", e instanceof Error ? e.message : String(e));
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