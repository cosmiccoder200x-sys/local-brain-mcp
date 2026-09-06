/**
 * quality.ts — Memory Quality Assessment, Noise Filtering, and Provenance Extraction.
 *
 * Implements conservative quality filters to ensure Local Brain retains durable,
 * high-signal engineering knowledge while rejecting ephemeral shell commands,
 * raw debug logs, and trivial noise.
 */
import type { MemoryCategory } from './db.js';
export interface QualityAssessment {
    isQuality: boolean;
    score: number;
    reason?: string;
}
/**
 * Evaluates whether a candidate lesson has sufficient engineering quality to be preserved.
 * Conservative design: keeps anything potentially useful, rejecting only unambiguous noise.
 */
export declare function evaluateMemoryQuality(content: string, category?: MemoryCategory): QualityAssessment;
/**
 * Extracts referenced file paths from memory text or markdown.
 */
export declare function extractReferencedFiles(text: string): string[];
//# sourceMappingURL=quality.d.ts.map