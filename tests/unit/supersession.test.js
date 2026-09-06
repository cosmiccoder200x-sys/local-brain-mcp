import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getDb,
  insertMemory,
  supersedeMemory,
  getMemoryById,
} from '../../dist/db.js';
import { recallMemories } from '../../dist/recall.js';
import { embed } from '../../dist/embeddings.js';

describe('Memory Evolution & Supersession', () => {
  const tmpDir = path.join(os.tmpdir(), `local-brain-super-test-${Date.now()}`);
  const dbPath = path.join(tmpDir, 'super-brain.db');
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

  it('correctly records supersession relationship and deprecates old memory', () => {
    // 1. Old memory
    const oldText = 'Use bcrypt library for hashing passwords with 10 salt rounds.';
    const oldVec = embed(oldText);
    const oldId = insertMemory(db, {
      category: 'architecture',
      content: oldText,
      summary: oldText,
      file_path: 'src/auth/hash.ts',
      status: 'active',
    }, oldVec);

    // 2. New memory replacing old memory
    const newText = 'Migrated password hashing from bcrypt to argon2id for higher GPU resistance.';
    const newVec = embed(newText);
    const newId = insertMemory(db, {
      category: 'architecture',
      content: newText,
      summary: newText,
      file_path: 'src/auth/hash.ts',
      status: 'active',
      supersedes_id: oldId,
    }, newVec);

    // Verify DB relationships
    const oldMem = getMemoryById(db, oldId);
    const newMem = getMemoryById(db, newId);

    assert.equal(oldMem.status, 'deprecated', 'Old memory must be marked deprecated');
    assert.equal(oldMem.superseded_by, newId, 'Old memory must point to newId');
    assert.equal(newMem.supersedes_id, oldId, 'New memory must point to oldId');
    assert.equal(newMem.status, 'active', 'New memory must be active');
  });

  it('recall prefers the current active memory over the superseded memory', async () => {
    const result = await recallMemories(db, {
      query: 'password hashing argon2 bcrypt',
      file_path: 'src/auth/hash.ts',
      include_deprecated: true,
    });

    assert.ok(result.memories.length > 0);
    // The top memory should be the active one
    assert.equal(result.memories[0].status, 'active');
    assert.ok(result.memories[0].summary.includes('argon2id'));
  });
});
