/**
 * embeddings.ts — Pure-JS local embedding engine using TF-IDF vectors.
 *
 * No ONNX. No external APIs. No downloads. Zero dependencies beyond vectra.
 *
 * Uses a hybrid approach:
 *   1. TF-IDF character n-gram hashing → fixed 384-dim float32 vector
 *   2. L2-normalized for cosine similarity search
 *
 * This is a practical, fast, offline-first alternative to transformer models.
 * Latency: < 1ms per embedding. Works fully offline.
 */
export declare const EMBEDDING_DIM = 384;
/**
 * Convert text to a fixed-size float32 vector via character n-gram hashing.
 * Implements a simplified "hashing trick" (feature hashing) used in sklearn.
 */
export declare function embed(text: string): Float32Array;
/**
 * Batch embed multiple texts.
 */
export declare function embedBatch(texts: string[]): Float32Array[];
/**
 * Cosine similarity between two L2-normalized vectors.
 * Since both are unit vectors, dot product == cosine similarity.
 */
export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
/**
 * No-op warmup (synchronous engine needs no warmup).
 */
export declare function warmupEmbeddings(): Promise<void>;
/**
 * Naive token count estimate (1 token ≈ 4 characters).
 */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=embeddings.d.ts.map