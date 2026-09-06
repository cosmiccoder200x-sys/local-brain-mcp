import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BASE_SCHEMA_SQL, insertMemory, insertEmbedding, getDbStats, closeDb } from '../dist/db.js';
import { recallMemories } from '../dist/recall.js';
import { embed } from '../dist/embeddings.js';

describe('Multi-Agent Concurrency & WAL Performance Tests', () => {
  let tempDir;
  let dbPath;

  before(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-brain-concurrency-'));
    dbPath = path.join(tempDir, 'brain.db');

    // Initialize DB with WAL mode
    const initDb = new Database(dbPath);
    initDb.exec(BASE_SCHEMA_SQL);
    initDb.pragma('journal_mode = WAL');
    initDb.pragma('synchronous = NORMAL');
    initDb.close();
  });

  after(async () => {
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
  });

  test('Multiple simulated agents can write concurrently without SQLite BUSY or data corruption', async () => {
    const agents = ['claude-code', 'cursor', 'antigravity', 'copilot', 'windsurf'];
    const NUM_WRITES_PER_AGENT = 10;

    // Simulate 5 parallel agent sessions each performing multiple write transactions
    const agentTasks = agents.map(async (agent) => {
      const db = new Database(dbPath, { timeout: 5000 });
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');

      for (let i = 0; i < NUM_WRITES_PER_AGENT; i++) {
        const text = `Engineering convention ${i} recorded by agent ${agent} for concurrent test`;
        const vec = embed(text);
        const id = insertMemory(db, {
          category: 'convention',
          content: text,
          summary: `Convention ${i} by ${agent}`,
          file_path: `src/agents/${agent}.ts`,
          agent,
          project_id: 'proj-concurrent',
          confidence: 0.95,
        }, vec);
        insertEmbedding(db, id, vec);
      }

      db.close();
    });

    await Promise.all(agentTasks);

    const verifyDb = new Database(dbPath);
    const stats = getDbStats(verifyDb);

    assert.strictEqual(stats.total, agents.length * NUM_WRITES_PER_AGENT);
    for (const agent of agents) {
      assert.strictEqual(stats.agent_breakdown[agent], NUM_WRITES_PER_AGENT);
    }

    verifyDb.close();
  });

  test('Concurrent read and recall operations succeed under heavy concurrent load', async () => {
    const readAgents = ['claude-code', 'cursor', 'antigravity'];
    const NUM_READS = 15;

    const readTasks = readAgents.map(async (agent) => {
      const db = new Database(dbPath, { timeout: 5000 });
      db.pragma('journal_mode = WAL');

      for (let i = 0; i < NUM_READS; i++) {
        const res = await recallMemories(db, {
          query: 'engineering convention concurrent',
          max_items: 5,
          agent_filter: i % 2 === 0 ? agent : undefined,
        });
        assert.ok(res.memories.length > 0, 'Should recall memories concurrently');
      }

      db.close();
    });

    await Promise.all(readTasks);
  });
});
