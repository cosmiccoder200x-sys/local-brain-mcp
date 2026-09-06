import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { BASE_SCHEMA_SQL, insertMemory, insertEmbedding, getDbStats, getMemoriesByAgent } from '../dist/db.js';
import { recallMemories } from '../dist/recall.js';
import { embed } from '../dist/embeddings.js';

describe('Multi-Agent Shared Memory Tests', () => {
  let db;

  before(() => {
    db = new Database(':memory:');
    db.exec(BASE_SCHEMA_SQL);
  });

  after(() => {
    db.close();
  });

  test('Multiple distinct agents can store engineering lessons into shared DB', () => {
    const agents = ['claude-code', 'cursor', 'antigravity', 'copilot', 'windsurf'];

    for (const agent of agents) {
      const content = `${agent}: Use structured logging with correlation IDs in microservices`;
      const vec = embed(content);
      const id = insertMemory(db, {
        category: 'architecture',
        content,
        summary: `Structured logging rule from ${agent}`,
        file_path: 'src/logger.ts',
        agent,
        project_id: 'proj1234',
        confidence: 0.95,
      }, vec);
      insertEmbedding(db, id, vec);
      assert.ok(id > 0, `Memory inserted by ${agent}`);
    }

    const stats = getDbStats(db);
    assert.strictEqual(stats.total, 5);
    assert.strictEqual(stats.agent_breakdown['claude-code'], 1);
    assert.strictEqual(stats.agent_breakdown['cursor'], 1);
    assert.strictEqual(stats.agent_breakdown['antigravity'], 1);
    assert.strictEqual(stats.agent_breakdown['copilot'], 1);
    assert.strictEqual(stats.agent_breakdown['windsurf'], 1);
  });

  test('Agent can recall memories contributed by other agents', async () => {
    const res = await recallMemories(db, {
      query: 'correlation IDs structured logging',
      file_path: 'src/logger.ts',
      max_items: 5,
    });

    assert.ok(res.memories.length >= 1, 'Should recall shared memories');
    const returnedAgents = new Set(res.memories.map(m => m.agent));
    assert.ok(returnedAgents.size >= 1, 'Recalls memories across agent boundaries');
    assert.ok(res.agent_breakdown !== undefined, 'Includes agent breakdown in result');
  });

  test('Agent filter restricts recall to specified agent when requested', async () => {
    const res = await recallMemories(db, {
      query: 'logging correlation IDs',
      agent_filter: 'antigravity',
      max_items: 5,
    });

    assert.ok(res.memories.length > 0);
    for (const m of res.memories) {
      assert.strictEqual(m.agent, 'antigravity');
    }
  });

  test('getMemoriesByAgent returns all records for an agent', () => {
    const cursorMemories = getMemoriesByAgent(db, 'cursor');
    assert.strictEqual(cursorMemories.length, 1);
    assert.strictEqual(cursorMemories[0].agent, 'cursor');
  });
});
