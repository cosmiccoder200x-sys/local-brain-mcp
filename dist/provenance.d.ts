/**
 * provenance.ts — Project identity, agent detection, and provenance utilities.
 *
 * Provides:
 *  - getProjectId()       — deterministic project identifier from git remote or path
 *  - detectAgent()        — best-effort agent detection from environment variables
 *  - buildProvenanceNote() — human-readable provenance string for trace output
 *  - AGENT_IDS            — canonical agent identifier set
 */
export declare const AGENT_IDS: readonly ["claude-code", "cursor", "antigravity", "copilot", "windsurf", "unknown"];
export type AgentId = (typeof AGENT_IDS)[number] | string;
export declare const IMPORTANCE_LEVELS: readonly ["low", "medium", "high", "critical"];
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];
/**
 * Best-effort agent detection from environment variables.
 * Returns 'unknown' if no agent can be identified.
 * Never throws — agent identity is always optional.
 */
export declare function detectAgent(): AgentId;
/**
 * Validates an agent ID string. Returns it normalized or 'unknown' if invalid.
 */
export declare function normalizeAgentId(raw?: string | null): AgentId;
/**
 * Derives a stable, 8-character project identifier from the git remote URL
 * or falls back to the absolute repo path. Uses SHA-256 for determinism.
 *
 * Two checkouts of the same repository → same project_id.
 * Different repositories → different project_id.
 */
export declare function getProjectId(repoRoot?: string): string;
export interface ProvenanceNote {
    agent: AgentId;
    source: string;
    project_id: string | null;
    branch: string | null;
    commit: string | null;
    files: string[];
    created_at: string;
    last_validated: string | null;
    validation_count: number;
    confidence: number;
    status: string;
}
/**
 * Builds a human-readable provenance summary for trace/explain output.
 */
export declare function buildProvenanceNote(note: ProvenanceNote): string;
//# sourceMappingURL=provenance.d.ts.map