import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  calculateFreshness,
  computeFinalScore,
  recallMemories,
  MAX_RESPONSE_TOKENS,
} from '../dist/recall.js';
import { getDb, insertMemory, insertEmbedding, closeDb } from '../dist/db.js';
import { embed } from '../dist/embeddings.js';

let tempDir;
let db;

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-brain-ranking-test-'));
  const dbPath = path.join(tempDir, 'brain.db');
  db = getDb(dbPath);
});

after(async () => {
  closeDb();
  await rm(tempDir, { recursive: true, force: true });
});

test('calculateFreshness provides exponential half-life decay', () => {
  const now = new Date().toISOString();
  const freshScore = calculateFreshness(now);
  assert.ok(freshScore > 0.95, `Recent memory should have freshness near 1.0, got ${freshScore}`);

  const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
  const decayedScore = calculateFreshness(fourMonthsAgo);
  assert.ok(decayedScore >= 0.45 && decayedScore <= 0.55, `120 days should have freshness ~0.50, got ${decayedScore}`);
});

test('computeFinalScore weights similarity, importance, freshness, and confidence deterministically', () => {
  const { finalScore } = computeFinalScore(
    0.8, // raw similarity
    'architecture', // category with 1.25 multiplier
    new Date().toISOString(), // fresh
    1.5, // importance
    1.0  // confidence
  );
  assert.ok(finalScore > 0.7 && finalScore <= 1.0, `Expected high composite score, got ${finalScore}`);
});

test('recallMemories enforces token budget and multi-factor ranking', async () => {
  // Insert several test memories
  const m1 = 'Critical breaking architecture change in packages/auth JWT rotation logic';
  const id1 = insertMemory(db, {
    category: 'architecture',
    content: m1,
    summary: m1,
    file_path: 'packages/auth/jwt.ts',
    package_scope: 'packages/auth',
    commit_hash: 'a1b2c3d',
    git_ref: 'main',
    status: 'active',
    source: 'git-ingest',
    token_count: 20,
    importance: 1.5,
    confidence: 1.0,
  });
  insertEmbedding(db, id1, embed(m1));

  const m2 = 'Minor typo in packages/ui button component margin padding';
  const id2 = insertMemory(db, {
    category: 'convention',
    content: m2,
    summary: m2,
    file_path: 'packages/ui/button.tsx',
    package_scope: 'packages/ui',
    commit_hash: 'e5f6g7h',
    git_ref: 'main',
    status: 'active',
    source: 'manual',
    token_count: 15,
    importance: 0.8,
    confidence: 1.0,
  });
  insertEmbedding(db, id2, embed(m2));

  // Search with scoping
  const resultScoped = await recallMemories(db, {
    query: 'JWT rotation',
    file_path: 'packages/auth/session.ts',
  });

  assert.ok(resultScoped.memories.length > 0);
  assert.equal(resultScoped.memories[0].category, 'architecture');
  assert.ok(resultScoped.total_tokens <= MAX_RESPONSE_TOKENS);
});
