import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { BASE_SCHEMA_SQL, insertMemory, insertEmbedding, detectContradictions, markContradiction, getMemoryById } from '../dist/db.js';
import { recallMemories } from '../dist/recall.js';
import { embed } from '../dist/embeddings.js';

describe('Contradiction Detection & Penalty Tests', () => {
  let db;

  before(() => {
    db = new Database(':memory:');
    db.exec(BASE_SCHEMA_SQL);
  });

  after(() => {
    db.close();
  });

  test('Detects contradiction when negation phrases are used with semantically related concepts', () => {
    const originalContent = 'Use jsonwebtoken library for all JWT token signing with RS256 algorithm in auth service';
    const origVec = embed(originalContent);
    const origId = insertMemory(db, {
      category: 'architecture',
      content: originalContent,
      summary: 'Use jsonwebtoken with RS256 for token signing',
      file_path: 'src/auth/jwt.ts',
      agent: 'claude-code',
      confidence: 0.9,
    }, origVec);
    insertEmbedding(db, origId, origVec);

    const newContradictingContent = 'We switched to jose library and no longer use jsonwebtoken with RS256 for JWT token signing';
    const newVec = embed(newContradictingContent);

    const result = detectContradictions(db, newVec, newContradictingContent);
    assert.ok(result.contradictedIds.includes(origId), 'Should detect conflict with original memory');

    const newId = insertMemory(db, {
      category: 'architecture',
      content: newContradictingContent,
      summary: 'Switched to jose, no longer use jsonwebtoken',
      file_path: 'src/auth/jwt.ts',
      agent: 'cursor',
      contradiction_flag: 1,
      contradiction_ids: JSON.stringify([origId]),
      confidence: 0.9,
    }, newVec);
    insertEmbedding(db, newId, newVec);

    markContradiction(db, origId, newId);

    const updatedOrig = getMemoryById(db, origId);
    const updatedNew = getMemoryById(db, newId);

    assert.strictEqual(updatedOrig.contradiction_flag, 1);
    assert.ok(updatedOrig.contradiction_ids.includes(String(newId)));
    assert.strictEqual(updatedNew.contradiction_flag, 1);
    assert.ok(updatedNew.contradiction_ids.includes(String(origId)));
  });

  test('Recall applies contradiction penalty and surfaces warning', async () => {
    const res = await recallMemories(db, {
      query: 'jsonwebtoken RS256 token signing auth',
      file_path: 'src/auth/jwt.ts',
      max_items: 5,
    });

    assert.ok(res.memories.length >= 1);
    assert.ok(res.contradictions > 0, 'Contradictions count should be reported in recall result');
    const flagged = res.memories.filter(m => m.contradiction_flag === 1);
    assert.ok(flagged.length > 0, 'Flagged memory surfaced in recall');
  });
});
