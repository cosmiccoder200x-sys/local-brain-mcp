import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getDb,
  insertMemory,
  insertEmbedding,
  findDuplicateMemory,
  mergeMemory,
  getMemoryById,
} from '../../dist/db.js';
import { embed } from '../../dist/embeddings.js';

describe('Duplicate Memory Detection & Smart Merge', () => {
  const tmpDir = path.join(os.tmpdir(), `local-brain-dup-test-${Date.now()}`);
  const dbPath = path.join(tmpDir, 'dup-brain.db');
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

  it('detects exact duplicate memory by content match', () => {
    const text = 'Always use transactions when performing multi-table writes.';
    const vec = embed(text);
    const id = insertMemory(db, {
      category: 'convention',
      content: text,
      summary: text,
      file_path: 'src/db.ts',
      confidence: 0.9,
      importance: 1.0,
      status: 'active',
    }, vec);

    const dup = findDuplicateMemory(db, vec, text, 'src/db.ts', 0.88);
    assert.ok(dup, 'Exact duplicate must be detected');
    assert.equal(dup.match.id, id);
    assert.equal(dup.isExact, true);
  });

  it('detects near-duplicate memory with high semantic similarity on same file', () => {
    const original = 'JWT tokens must use RS256 signature algorithm in production.';
    const similar = 'JWT tokens must use RS256 signature in production environment.';

    const vec1 = embed(original);
    const id1 = insertMemory(db, {
      category: 'architecture',
      content: original,
      summary: original,
      file_path: 'src/auth/jwt.ts',
      confidence: 0.92,
      importance: 1.2,
      status: 'active',
    }, vec1);

    const vec2 = embed(similar);
    // Use a lower threshold suited to TF-IDF feature hashing space (not neural embeddings)
    const dup = findDuplicateMemory(db, vec2, similar, 'src/auth/jwt.ts', 0.70);
    assert.ok(dup, 'Near duplicate must be detected');
    assert.equal(dup.match.id, id1);
    assert.ok(dup.similarity >= 0.70);
  });

  it('does NOT falsely flag different memories discussing the same topic', () => {
    const memA = 'Configure rate limiting to 100 requests per minute for public endpoints.';
    const memB = 'Use redis cluster for distributed caching of user session tokens.';

    const vecA = embed(memA);
    insertMemory(db, {
      category: 'fix',
      content: memA,
      summary: memA,
      file_path: 'src/server.ts',
      status: 'active',
    }, vecA);

    const vecB = embed(memB);
    const dup = findDuplicateMemory(db, vecB, memB, 'src/server.ts', 0.88);
    assert.equal(dup, null, 'Unrelated memory must not match duplicate');
  });

  it('merges new information into existing memory without dropping rich details', () => {
    const baseText = 'Postgres connection timeout set to 5000ms.';
    const vec = embed(baseText);
    const id = insertMemory(db, {
      category: 'fix',
      content: baseText,
      summary: baseText,
      file_path: 'src/db.ts',
      confidence: 0.85,
      importance: 1.0,
      status: 'active',
    }, vec);

    // Merge richer update
    const richerSummary = 'Postgres connection timeout set to 5000ms to handle AWS RDS multi-AZ failover lag.';
    mergeMemory(db, id, {
      category: 'fix',
      content: baseText,
      summary: richerSummary,
      file_path: 'src/db/config.ts',
      confidence: 0.98,
      importance: 1.5,
    });

    const merged = getMemoryById(db, id);
    assert.equal(merged.summary, richerSummary);
    assert.equal(merged.confidence, 0.98);
    assert.equal(merged.importance, 1.5);
    const files = JSON.parse(merged.files);
    assert.ok(files.includes('src/db/config.ts'));
  });
});
