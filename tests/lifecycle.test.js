import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  BASE_SCHEMA_SQL,
  insertMemory,
  insertEmbedding,
  validateMemory,
  detectContradictions,
  markContradiction,
  getMemoryById,
  getDbStats,
} from '../dist/db.js';
import { recallMemories, traceFile } from '../dist/recall.js';
import { embed } from '../dist/embeddings.js';

describe('Multi-Agent End-to-End Memory Lifecycle', () => {
  let db;

  before(() => {
    db = new Database(':memory:');
    db.exec(BASE_SCHEMA_SQL);
  });

  after(() => {
    db.close();
  });

  test('Step 1: Agent Claude Code learns and stores initial architecture decision', () => {
    const lesson = 'Use SQLite with WAL journal mode for all local persistence in microservices';
    const vec = embed(lesson);
    const id = insertMemory(db, {
      category: 'architecture',
      content: lesson,
      summary: 'SQLite with WAL mode for local microservice persistence',
      file_path: 'src/db.ts',
      agent: 'claude-code',
      project_id: 'lifecycle-1',
      confidence: 0.90,
      importance: 1.5,
    }, vec);
    insertEmbedding(db, id, vec);

    const mem = getMemoryById(db, id);
    assert.strictEqual(mem.agent, 'claude-code');
    assert.strictEqual(mem.validation_count, 0);
    assert.strictEqual(mem.status, 'active');
  });

  test('Step 2: Agent Cursor recalls the lesson and validates its correctness', async () => {
    const recall = await recallMemories(db, {
      query: 'SQLite WAL mode persistence',
      file_path: 'src/db.ts',
    });

    assert.strictEqual(recall.memories.length, 1);
    const target = recall.memories[0];
    assert.strictEqual(target.agent, 'claude-code');

    // Agent Cursor validates the memory
    const valOk = validateMemory(db, target.id, 'cursor');
    assert.strictEqual(valOk, true);

    const updated = getMemoryById(db, target.id);
    assert.strictEqual(updated.validation_count, 1);
    assert.strictEqual(updated.validated_by, 'cursor');
    assert.ok(updated.confidence > 0.90, 'Confidence boosted after validation');
  });

  test('Step 3: Agent Antigravity also validates the memory, boosting validation count and rank', async () => {
    const target = (await recallMemories(db, { query: 'SQLite WAL' })).memories[0];
    validateMemory(db, target.id, 'antigravity');

    const updated = getMemoryById(db, target.id);
    assert.strictEqual(updated.validation_count, 2);
    assert.strictEqual(updated.validated_by, 'antigravity');

    const recall = await recallMemories(db, { query: 'SQLite WAL' });
    assert.strictEqual(recall.memories[0].validation_count, 2);
  });

  test('Step 4: Agent Windsurf notices a deprecation and contradicts the old convention', async () => {
    const oldMem = (await recallMemories(db, { query: 'SQLite WAL' })).memories[0];

    const newLesson = 'We switched to DuckDB and no longer use SQLite with WAL mode for analytics workloads';
    const newVec = embed(newLesson);

    const contradictionCheck = detectContradictions(db, newVec, newLesson, 'lifecycle-1');
    assert.ok(contradictionCheck.contradictedIds.includes(oldMem.id));

    const newId = insertMemory(db, {
      category: 'architecture',
      content: newLesson,
      summary: 'Switched to DuckDB, no longer use SQLite for analytics',
      file_path: 'src/db.ts',
      agent: 'windsurf',
      project_id: 'lifecycle-1',
      contradiction_flag: 1,
      contradiction_ids: JSON.stringify([oldMem.id]),
    }, newVec);
    insertEmbedding(db, newId, newVec);

    markContradiction(db, oldMem.id, newId);

    const recall = await recallMemories(db, { query: 'SQLite DuckDB analytics persistence' });
    assert.strictEqual(recall.contradictions >= 1, true);
  });

  test('Step 5: traceFile demonstrates complete multi-agent provenance history', () => {
    const history = traceFile(db, 'src/db.ts');
    assert.strictEqual(history.length, 2);

    const agentsInTrace = history.map(h => h.agent);
    assert.ok(agentsInTrace.includes('claude-code'));
    assert.ok(agentsInTrace.includes('windsurf'));
  });

  test('Step 6: getDbStats reflects multi-agent breakdown and validation health', () => {
    const stats = getDbStats(db);
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.validated, 1);
    assert.strictEqual(stats.contradicted, 2);
    assert.strictEqual(stats.agent_breakdown['claude-code'], 1);
    assert.strictEqual(stats.agent_breakdown['windsurf'], 1);
  });
});
