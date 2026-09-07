/**
 * provenance.ts — Project identity, agent detection, and provenance utilities.
 *
 * Provides:
 *  - getProjectId()       — deterministic project identifier from git remote or path
 *  - detectAgent()        — best-effort agent detection from environment variables
 *  - buildProvenanceNote() — human-readable provenance string for trace output
 *  - AGENT_IDS            — canonical agent identifier set
 */
import { execSync } from "child_process";
import { createHash } from "crypto";
import path from "path";
import { debugLog } from "./debug.js";
// ─── Agent Identity ────────────────────────────────────────────────────────────
export const AGENT_IDS = [
    "claude-code",
    "cursor",
    "antigravity",
    "copilot",
    "windsurf",
    "unknown",
];
export const IMPORTANCE_LEVELS = ["low", "medium", "high", "critical"];
/**
 * Best-effort agent detection from environment variables.
 * Returns 'unknown' if no agent can be identified.
 * Never throws — agent identity is always optional.
 */
export function detectAgent() {
    // Claude Code sets CLAUDE_CODE_VERSION or similar
    if (process.env.CLAUDE_CODE_VERSION || process.env.CLAUDE_SESSION_ID) {
        return "claude-code";
    }
    // Cursor sets CURSOR_TRACE_ID or CURSOR_SESSION_ID
    if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_SESSION_ID) {
        return "cursor";
    }
    // Antigravity (Google DeepMind IDE)
    if (process.env.ANTIGRAVITY_SESSION || process.env.ANTIGRAVITY_VERSION) {
        return "antigravity";
    }
    // GitHub Copilot
    if (process.env.GITHUB_COPILOT_CHAT_SESSION || process.env.COPILOT_SESSION) {
        return "copilot";
    }
    // Windsurf
    if (process.env.WINDSURF_SESSION_ID || process.env.CODEIUM_SESSION) {
        return "windsurf";
    }
    // Explicit override for all agents
    if (process.env.LOCAL_BRAIN_AGENT) {
        return process.env.LOCAL_BRAIN_AGENT;
    }
    return "unknown";
}
/**
 * Validates an agent ID string. Returns it normalized or 'unknown' if invalid.
 */
export function normalizeAgentId(raw) {
    if (!raw || typeof raw !== "string")
        return "unknown";
    const trimmed = raw.trim().toLowerCase().slice(0, 64);
    return trimmed || "unknown";
}
// ─── Project Identity ──────────────────────────────────────────────────────────
/**
 * Derives a stable, 8-character project identifier from the git remote URL
 * or falls back to the absolute repo path. Uses SHA-256 for determinism.
 *
 * Two checkouts of the same repository → same project_id.
 * Different repositories → different project_id.
 */
export function getProjectId(repoRoot) {
    const root = repoRoot ?? process.cwd();
    // 1. Try git remote URL — most reliable across machines
    try {
        const remote = execSync("git remote get-url origin", {
            cwd: root,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        if (remote) {
            // Normalize: strip protocol, .git suffix, trailing slashes
            const normalized = remote
                .replace(/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/, "")
                .replace(/\.git$/, "")
                .replace(/[:/]/g, "/")
                .toLowerCase()
                .replace(/\/$/, "");
            return createHash("sha256").update(normalized).digest("hex").slice(0, 8);
        }
    }
    catch (e) {
        debugLog("provenance", "Failed to get git remote URL: %s", e instanceof Error ? e.message : String(e));
        // no git remote — fall through to path-based ID
    }
    // 2. Fall back to normalized absolute path
    const normalizedPath = path.resolve(root).replace(/\\/g, "/").toLowerCase();
    return createHash("sha256").update(normalizedPath).digest("hex").slice(0, 8);
}
/**
 * Builds a human-readable provenance summary for trace/explain output.
 */
export function buildProvenanceNote(note) {
    const parts = [];
    parts.push(`Agent: ${note.agent}`);
    parts.push(`Source: ${note.source}`);
    if (note.project_id)
        parts.push(`Project: ${note.project_id}`);
    if (note.branch)
        parts.push(`Branch: ${note.branch}`);
    if (note.commit)
        parts.push(`Commit: ${note.commit.slice(0, 7)}`);
    if (note.files.length > 0)
        parts.push(`Files: ${note.files.slice(0, 3).join(", ")}`);
    parts.push(`Confidence: ${Math.round(note.confidence * 100)}%`);
    parts.push(`Status: ${note.status}`);
    if (note.validation_count > 0) {
        parts.push(`Validated: ${note.validation_count}× (last: ${note.last_validated ?? "n/a"})`);
    }
    parts.push(`Created: ${note.created_at}`);
    return parts.join(" | ");
}
//# sourceMappingURL=provenance.js.map