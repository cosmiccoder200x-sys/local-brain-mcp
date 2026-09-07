/**
 * config.ts — Centralized configuration constants for Local Brain MCP.
 *
 * All tunable thresholds and magic numbers live here. Environment variable
 * overrides are supported for key settings.
 */
// ─── Recall & Ranking ──────────────────────────────────────────────────────────
/** Maximum tokens returned in a single recall response. */
export const MAX_RESPONSE_TOKENS = envInt("LOCAL_BRAIN_MAX_TOKENS", 250);
/** Half-life in days for recency/freshness exponential decay. */
export const FRESHNESS_HALF_LIFE_DAYS = envInt("LOCAL_BRAIN_FRESHNESS_HALF_LIFE", 120);
/** Similarity threshold for near-duplicate detection. */
export const DUPLICATE_SIMILARITY_THRESHOLD = envFloat("LOCAL_BRAIN_DUP_THRESHOLD", 0.9);
/** Similarity threshold for contradiction detection. */
export const CONTRADICTION_SIMILARITY_THRESHOLD = envFloat("LOCAL_BRAIN_CONTRADICTION_THRESHOLD", 0.35);
/** Maximum characters allowed for a single lesson. */
export const MAX_LESSON_LENGTH = envInt("LOCAL_BRAIN_MAX_LESSON_LENGTH", 10000);
/** Stale change threshold: if a file changes more than this fraction, memories are invalidated. */
export const STALE_CHANGE_THRESHOLD = envFloat("LOCAL_BRAIN_STALE_THRESHOLD", 0.3);
/** Confidence boost per validation event. */
export const VALIDATION_CONFIDENCE_BOOST = 0.05;
/** Maximum confidence cap. */
export const MAX_CONFIDENCE = 0.99;
// ─── Ranking Weights ───────────────────────────────────────────────────────────
export const RANKING_WEIGHTS = {
    similarity: 0.45,
    scope: 0.2,
    recency: 0.1,
    confidence: 0.1,
    importance: 0.05,
    validation: 0.05,
    quality: 0.05,
};
export const STATUS_MULTIPLIERS = {
    active: 1.0,
    stale: 0.25,
    deprecated: 0.05,
};
export const CONTRADICTION_PENALTY = 0.6;
// ─── CLI ───────────────────────────────────────────────────────────────────────
/** Maximum memories to display in CLI `memories` command. */
export const CLI_MAX_MEMORIES = 500;
// ─── Embeddings ────────────────────────────────────────────────────────────────
export const EMBEDDING_DIM = 384;
// ─── Helpers ───────────────────────────────────────────────────────────────────
function envInt(key, fallback) {
    const raw = process.env[key];
    if (raw === undefined)
        return fallback;
    const n = parseInt(raw, 10);
    return isNaN(n) ? fallback : n;
}
function envFloat(key, fallback) {
    const raw = process.env[key];
    if (raw === undefined)
        return fallback;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
}
//# sourceMappingURL=config.js.map