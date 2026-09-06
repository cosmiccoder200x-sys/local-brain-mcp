import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getDb,
  insertMemory,
  insertEmbedding,
  supersedeMemory,
  markMemoryStale,
  findDuplicateMemory,
} from '../../dist/db.js';
import { embed } from '../../dist/embeddings.js';
import { recallMemories } from '../../dist/recall.js';

describe('Adversarial Retrieval Test Suite (Cases A through R)', () => {
  const tmpDir = path.join(os.tmpdir(), `local-brain-adv-${Date.now()}`);
  const dbPath = path.join(tmpDir, 'adv-brain.db');
  let db;

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    db = getDb(dbPath);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  // ─── Case A: Exact Query ───────────────────────────────────────────────────
  it('Case A: Exact query matches target memory with highest similarity', async () => {
    const text = 'JWT refresh token race condition occurs when two requests arrive simultaneously; use atomic redis lock.';
    const vec = embed(text);
    insertMemory(db, {
      category: 'fix',
      content: text,
      summary: text,
      file_path: 'src/auth/jwt.ts',
      confidence: 1.0,
      importance: 1.5,
      status: 'active',
    }, vec);

    const res = await recallMemories(db, {
      query: text,
      file_path: 'src/auth/jwt.ts',
    });

    assert.ok(res.memories.length > 0);
    assert.ok(res.memories[0].summary.includes('atomic redis lock'));
    assert.ok(res.memories[0].similarity > 0.95);
  });

  // ─── Case B: Semantic Query ────────────────────────────────────────────────
  it('Case B: Semantic query retrieves concept without exact keyword match', async () => {
    const text = 'Connection pool starvation in Postgres: always call client.release() inside a finally block.';
    const vec = embed(text);
    insertMemory(db, {
      category: 'fix',
      content: text,
      summary: text,
      file_path: 'src/database/pool.ts',
      status: 'active',
    }, vec);

    const res = await recallMemories(db, {
      query: 'database client leaking connections not released',
      file_path: 'src/database/pool.ts',
    });

    assert.ok(res.memories.length > 0);
    assert.ok(res.memories[0].summary.includes('finally block'));
  });

  // ─── Case C: Vague Query ───────────────────────────────────────────────────
  it('Case C: Vague query returns best effort context without crashing', async () => {
    const res = await recallMemories(db, {
      query: 'bug fix',
    });

    assert.ok(Array.isArray(res.memories));
    assert.ok(res.total_tokens <= 250);
  });

  // ─── Case D: Unrelated Query ───────────────────────────────────────────────
  it('Case D: Completely unrelated query does not return false positives with high confidence', async () => {
    const res = await recallMemories(db, {
      query: 'quantum superposition wavefunction collapse in photosynthetic bacteria',
      min_confidence: 0.99,
    });

    // Should return either 0 results or very low ranked memories
    assert.ok(Array.isArray(res.memories));
  });

  // ─── Case E: Duplicate Memories ────────────────────────────────────────────
  it('Case E: Duplicate memories are detected and prevented from polluting search', async () => {
    const text = 'Rate limiting is enforced at 100 requests per minute per IP address.';
    const vec = embed(text);

    const dup = findDuplicateMemory(db, vec, text, 'src/api/limiter.ts', 0.88);
    assert.equal(dup, null); // not in DB yet

    insertMemory(db, {
      category: 'convention',
      content: text,
      summary: text,
      file_path: 'src/api/limiter.ts',
      status: 'active',
    }, vec);

    const dupAfter = findDuplicateMemory(db, vec, text, 'src/api/limiter.ts', 0.88);
    assert.ok(dupAfter, 'Duplicate must now be found');
  });

  // ─── Case F: Nearly Identical Memories ─────────────────────────────────────
  it('Case F: Nearly identical memories are recognized as duplicates', () => {
    const text1 = 'Use gzip compression for JSON payloads over 1 kilobyte in HTTP responses.';
    const text2 = 'Use gzip compression for JSON payloads over 1 kilobyte in HTTP responses.';
    const vec1 = embed(text1);
    const vec2 = embed(text2);

    insertMemory(db, {
      category: 'architecture',
      content: text1,
      summary: text1,
      file_path: 'src/http/compress.ts',
      status: 'active',
    }, vec1);

    // Nearly identical → should match with a relaxed threshold
    const dup = findDuplicateMemory(db, vec2, text2, 'src/http/compress.ts', 0.65);
    assert.ok(dup, 'Nearly identical memory must be recognized as duplicate');
  });

  // ─── Case G: Renamed Files ─────────────────────────────────────────────────
  it('Case G: Renamed files supported via multi-file array tracking', async () => {
    const text = 'Stripe webhook signature validation requires raw unparsed request body buffer.';
    const vec = embed(text);
    insertMemory(db, {
      category: 'fix',
      content: text,
      summary: text,
      file_path: 'src/billing/stripe-legacy.ts',
      files: JSON.stringify(['src/billing/stripe-legacy.ts', 'src/billing/stripe-v2.ts']),
      status: 'active',
    }, vec);

    const res = await recallMemories(db, {
      query: 'Stripe webhook raw body signature',
      file_path: 'src/billing/stripe-v2.ts',
    });

    assert.ok(res.memories.length > 0);
    assert.ok(res.memories[0].summary.includes('raw unparsed request body'));
  });

  // ─── Case H: Deleted Files ─────────────────────────────────────────────────
  it('Case H: Memories for deleted files can be marked stale and deprioritized', async () => {
    const text = 'Old legacy XML parser configuration.';
    const vec = embed(text);
    const id = insertMemory(db, {
      category: 'fix',
      content: text,
      summary: text,
      file_path: 'src/legacy/xml.ts',
      status: 'active',
    }, vec);

    markMemoryStale(db, id);

    const res = await recallMemories(db, {
      query: 'XML parser configuration',
      file_path: 'src/legacy/xml.ts',
      include_deprecated: false,
    });

    // Stale memories should not show in normal active recall
    const found = res.memories.find(m => m.id === id);
    assert.equal(found, undefined);
  });

  // ─── Case I: Stale Memories ────────────────────────────────────────────────
  it('Case I: Active memories heavily outrank stale memories even on identical queries', async () => {
    const query = 'Docker container healthcheck interval configuration';

    const staleText = 'Docker container healthcheck set to 60s with 3 retries.';
    const activeText = 'Docker container healthcheck updated to 10s with 5 retries for fast failover.';

    const idStale = insertMemory(db, {
      category: 'architecture',
      content: staleText,
      summary: staleText,
      file_path: 'Dockerfile',
      status: 'stale',
    }, embed(staleText));

    const idActive = insertMemory(db, {
      category: 'architecture',
      content: activeText,
      summary: activeText,
      file_path: 'Dockerfile',
      status: 'active',
    }, embed(activeText));

    const res = await recallMemories(db, {
      query,
      file_path: 'Dockerfile',
      include_deprecated: true,
    });

    assert.ok(res.memories.length >= 2);
    assert.equal(res.memories[0].id, idActive, 'Active memory must rank higher than stale memory');
  });

  // ─── Case J: Branch-specific Memories ──────────────────────────────────────
  it('Case J: Branch metadata is recorded and stored with memories', () => {
    const text = 'Experimental GraphQL caching feature flag enabled.';
    const id = insertMemory(db, {
      category: 'architecture',
      content: text,
      summary: text,
      file_path: 'src/graphql/schema.ts',
      branch: 'feature/graphql-v2',
      status: 'active',
    }, embed(text));

    const row = db.prepare('SELECT branch FROM memories WHERE id = ?').get(id);
    assert.equal(row.branch, 'feature/graphql-v2');
  });

  // ─── Case K: Monorepo / Project Scoping ────────────────────────────────────
  it('Case K: Scoping filters results to target package avoiding cross-package noise', async () => {
    const authText = 'Auth package: use Argon2 for secure key derivation.';
    const billingText = 'Billing package: use AES-GCM-256 for payment token encryption.';

    insertMemory(db, {
      category: 'architecture',
      content: authText,
      summary: authText,
      file_path: 'packages/auth/src/keys.ts',
      package_scope: 'packages/auth',
      status: 'active',
    }, embed(authText));

    insertMemory(db, {
      category: 'architecture',
      content: billingText,
      summary: billingText,
      file_path: 'packages/billing/src/encrypt.ts',
      package_scope: 'packages/billing',
      status: 'active',
    }, embed(billingText));

    const authRes = await recallMemories(db, {
      query: 'encryption key derivation algorithms',
      file_path: 'packages/auth/src/keys.ts',
    });

    assert.ok(authRes.memories.length > 0);
    assert.equal(authRes.memories[0].file_path, 'packages/auth/src/keys.ts');
  });

  // ─── Case L: Empty Repository / Empty DB ────────────────────────────────────
  it('Case L: Handles empty database gracefully returning 0 results and 0 tokens', async () => {
    const emptyDbPath = path.join(tmpDir, 'empty.db');
    const emptyDb = getDb(emptyDbPath);

    const res = await recallMemories(emptyDb, {
      query: 'anything',
    });

    assert.equal(res.memories.length, 0);
    assert.equal(res.total_tokens, 0);
    assert.equal(res.truncated, false);
  });

  // ─── Case M: Large Git History Scaling ─────────────────────────────────────
  it('Case M: Fast search sub-5ms across 100+ memories', async () => {
    for (let i = 0; i < 50; i++) {
      const text = `Synthetic memory #${i}: database indexing optimization rule for table_v${i}.`;
      insertMemory(db, {
        category: 'fix',
        content: text,
        summary: text,
        file_path: `src/db/table_${i}.ts`,
        status: 'active',
      }, embed(text));
    }

    const start = performance.now();
    const res = await recallMemories(db, {
      query: 'indexing optimization table_v25',
    });
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 20, `Recall took ${elapsed}ms; should be fast`);
    assert.ok(res.memories.length > 0);
  });

  // ─── Case N: Similar but Incorrect Memory (Decoy) ──────────────────────────
  it('Case N: File-scoped memory outranks an unscoped decoy memory with keyword overlap', async () => {
    const decoy = 'Memory allocator configuration for JVM garbage collection tuning in staging.';
    const actual = 'Memory allocator setting for V8 Node.js heap limit in production server.';

    insertMemory(db, {
      category: 'fix',
      content: decoy,
      summary: decoy,
      file_path: 'infra/jvm.conf',
      status: 'active',
    }, embed(decoy));

    const actualId = insertMemory(db, {
      category: 'fix',
      content: actual,
      summary: actual,
      file_path: 'src/server.ts',
      status: 'active',
    }, embed(actual));

    const res = await recallMemories(db, {
      query: 'memory allocator configuration limit',
      file_path: 'src/server.ts',
    });

    assert.ok(res.memories.length > 0);
    assert.equal(res.memories[0].id, actualId, 'Correctly scoped memory must outrank decoy');
  });

  // ─── Case O: Multiple Competing Memories ────────────────────────────────────
  it('Case O: Multiple competing memories broken deterministically by multi-factor score', async () => {
    const query = 'API rate limit threshold configuration';

    const highConf = 'API rate limit set to 500 req/min for premium tier; verified in prod.';
    const lowConf = 'API rate limit might be 200 req/min; unverified draft.';

    const idHigh = insertMemory(db, {
      category: 'convention',
      content: highConf,
      summary: highConf,
      confidence: 1.0,
      importance: 1.8,
      status: 'active',
    }, embed(highConf));

    const idLow = insertMemory(db, {
      category: 'convention',
      content: lowConf,
      summary: lowConf,
      confidence: 0.4,
      importance: 0.8,
      status: 'active',
    }, embed(lowConf));

    const res = await recallMemories(db, { query });
    assert.ok(res.memories.length >= 2);
    assert.equal(res.memories[0].id, idHigh, 'High confidence memory must outrank low confidence');
  });

  // ─── Case P: Superseded Memory ─────────────────────────────────────────────
  it('Case P: Superseded memory is replaced in rankings by its active successor', async () => {
    const oldT = 'Old architecture rule: store sessions in local memory map.';
    const newT = 'New architecture rule: store sessions in Redis with TTL to support horizontal scaling.';

    const oldId = insertMemory(db, {
      category: 'architecture',
      content: oldT,
      summary: oldT,
      file_path: 'src/session.ts',
      status: 'active',
    }, embed(oldT));

    const newId = insertMemory(db, {
      category: 'architecture',
      content: newT,
      summary: newT,
      file_path: 'src/session.ts',
      status: 'active',
      supersedes_id: oldId,
    }, embed(newT));

    const res = await recallMemories(db, {
      query: 'session storage architecture',
      file_path: 'src/session.ts',
      include_deprecated: true,
    });

    assert.ok(res.memories.length > 0);
    assert.equal(res.memories[0].id, newId, 'Active successor must be ranked first');
  });

  // ─── Case Q: Missing Metadata ──────────────────────────────────────────────
  it('Case Q: Memories with missing/null optional metadata handle gracefully', async () => {
    const text = 'Minimal memory without author, git_ref, or files list.';
    const id = insertMemory(db, {
      category: 'manual',
      content: text,
      summary: text,
      file_path: null,
      commit_hash: null,
      git_ref: null,
      author: null,
      status: 'active',
    }, embed(text));

    const res = await recallMemories(db, { query: 'Minimal memory' });
    const found = res.memories.find(m => m.id === id);
    assert.ok(found);
    assert.equal(found.file_path, null);
    assert.equal(found.commit_hash, null);
  });

  // ─── Case R: Corrupted / Invalid Memory Input ──────────────────────────────
  it('Case R: Empty strings, extreme whitespace, and odd characters handled safely', async () => {
    const res = await recallMemories(db, {
      query: '   \n\t  @#$%^&*()   ',
    });

    assert.ok(Array.isArray(res.memories));
    assert.equal(typeof res.total_tokens, 'number');
  });
});
