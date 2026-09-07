/**
 * config.ts — Centralized configuration constants for Local Brain MCP.
 *
 * All tunable thresholds and magic numbers live here. Environment variable
 * overrides are supported for key settings.
 */
/** Maximum tokens returned in a single recall response. */
export declare const MAX_RESPONSE_TOKENS: number;
/** Half-life in days for recency/freshness exponential decay. */
export declare const FRESHNESS_HALF_LIFE_DAYS: number;
/** Similarity threshold for near-duplicate detection. */
export declare const DUPLICATE_SIMILARITY_THRESHOLD: number;
/** Similarity threshold for contradiction detection. */
export declare const CONTRADICTION_SIMILARITY_THRESHOLD: number;
/** Maximum characters allowed for a single lesson. */
export declare const MAX_LESSON_LENGTH: number;
/** Stale change threshold: if a file changes more than this fraction, memories are invalidated. */
export declare const STALE_CHANGE_THRESHOLD: number;
/** Confidence boost per validation event. */
export declare const VALIDATION_CONFIDENCE_BOOST = 0.05;
/** Maximum confidence cap. */
export declare const MAX_CONFIDENCE = 0.99;
export declare const RANKING_WEIGHTS: {
    readonly similarity: 0.45;
    readonly scope: 0.2;
    readonly recency: 0.1;
    readonly confidence: 0.1;
    readonly importance: 0.05;
    readonly validation: 0.05;
    readonly quality: 0.05;
};
export declare const STATUS_MULTIPLIERS: {
    readonly active: 1;
    readonly stale: 0.25;
    readonly deprecated: 0.05;
};
export declare const CONTRADICTION_PENALTY = 0.6;
/** Maximum memories to display in CLI `memories` command. */
export declare const CLI_MAX_MEMORIES = 500;
export declare const EMBEDDING_DIM = 384;
//# sourceMappingURL=config.d.ts.map