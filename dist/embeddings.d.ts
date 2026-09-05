/**
 * embeddings.ts — Pure-JS local embedding engine using code-aware TF-IDF feature hashing.
 *
 * No ONNX runtime. No external APIs. No remote telemetry. Zero dependencies.
 *
 * Architecture:
 *   1. Code-aware tokenizer (splits camelCase, snake_case, dot notation & paths)
 *   2. Stopword suppression to eliminate hash bucket noise
 *   3. Sublinear term-frequency scaling: tf / (tf + 1.2)
 *   4. Word unigrams + bigrams + character trigrams hashed to 384 dimensions
 *   5. L2-normalized float32 vectors for exact cosine similarity search
 *
 * Latency: < 0.2ms per embedding. 100% offline and deterministic.
 */
export declare const EMBEDDING_DIM = 384;
/**
 * FNV-1a hash of a string, mapped to a bucket in [0, dim).
 */
export declare function hashToBucket(s: string, dim?: number): number;
/**
 * Sign function for hashing — ensures pseudo-random cancellation in the vector.
 */
export declare function hashSign(s: string): number;
/**
 * Code-aware tokenizer that splits text and code identifiers into searchable subwords.
 * Examples:
 *   "authService.verifyJWT()" -> ["auth", "service", "verify", "jwt", "authservice", "verifyjwt"]
 *   "db_connection_pool"      -> ["db", "connection", "pool", "db_connection_pool"]
 */
export declare function tokenize(text: string): string[];
/**
 * Convert text to a fixed-size float32 vector via code-aware feature hashing.
 */
export declare function embed(text: string): Float32Array;
/**
 * Batch embed multiple texts synchronously.
 */
export declare function embedBatch(texts: string[]): Float32Array[];
/**
 * Cosine similarity between two vectors.
 * If both are L2-normalized unit vectors, dot product equals cosine similarity.
 */
export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
/**
 * Warmup routine (synchronous pure-JS engine ready immediately).
 */
export declare function warmupEmbeddings(): Promise<void>;
/**
 * Standard token count estimate (1 token ≈ 4 characters).
 */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=embeddings.d.ts.map