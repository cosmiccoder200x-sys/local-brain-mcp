import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getDb,
  insertMemory,
  getMemoryById,
  updateMemory,
  supersedeMemory,
  forgetMemory,
  pruneByStatus,
  getDbStats,
  migrateDb,
} from '../../dist/db.js';

describe('Database & Migrations', () => {
  const tmpDir = path.join(os.tmpdir(), `local-brain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const dbPath = path.join(tmpDir, 'test-brain.db');

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('initializes a fresh database with full schema and indexes', () => {
    const db = getDb(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    assert.ok(tables.includes('memories'), 'memories table must exist');
    assert.ok(tables.includes('file_snapshots'), 'file_snapshots table must exist');
    assert.ok(tables.includes('ingested_commits'), 'ingested_commits table must exist');
  });

  it('handles idempotent migrations on legacy schema without losing data', () => {
    const legacyDbPath = path.join(tmpDir, 'legacy-brain.db');
    const legacyDb = new Database(legacyDbPath);

    // Create v1 schema (without Phase 2/3 columns)
    legacyDb.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        file_path TEXT,
        package_scope TEXT,
        commit_hash TEXT,
        git_ref TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT DEFAULT 'git-ingest',
        token_count INTEGER DEFAULT 0,
        embedding BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert legacy record
    legacyDb.prepare(`
      INSERT INTO memories (category, content, summary, file_path, status)
      VALUES ('fix', 'Legacy memory before migration', 'Legacy summary', 'src/auth.ts', 'active')
    `).run();

    // Run migration
    migrateDb(legacyDb);

    // Verify record is intact
    const row = legacyDb.prepare('SELECT * FROM memories WHERE id = 1').get();
    assert.equal(row.content, 'Legacy memory before migration');
    assert.equal(row.confidence, 1.0); // default applied
    assert.equal(row.importance, 1.0); // default applied
    assert.equal(row.quality_score, 1.0); // default applied
    assert.equal(row.superseded_by, null);

    // Running migration a second time should be completely safe and idempotent
    assert.doesNotThrow(() => migrateDb(legacyDb));

    legacyDb.close();
  });

  it('performs CRUD operations correctly', () => {
    const db = getDb(dbPath);

    // 1. Insert
    const id = insertMemory(db, {
      category: 'fix',
      content: 'Fix PostgreSQL connection leak by releasing client in finally block.',
      summary: 'PostgreSQL connection leak fix.',
      file_path: 'src/db/pool.ts',
      files: JSON.stringify(['src/db/pool.ts', 'src/db/client.ts']),
      author: 'dev@company.com',
      confidence: 0.95,
      importance: 1.5,
      quality_score: 1.2,
      status: 'active',
      source: 'manual',
    });
    assert.ok(id > 0);

    // 2. Read
    const mem = getMemoryById(db, id);
    assert.ok(mem);
    assert.equal(mem.file_path, 'src/db/pool.ts');
    assert.equal(mem.confidence, 0.95);
    assert.equal(mem.importance, 1.5);
    assert.equal(mem.author, 'dev@company.com');

    // 3. Update
    const updated = updateMemory(db, id, { confidence: 0.99, summary: 'Updated summary' });
    assert.equal(updated, true);
    const mem2 = getMemoryById(db, id);
    assert.equal(mem2.confidence, 0.99);
    assert.equal(mem2.summary, 'Updated summary');

    // 4. Stats
    const stats = getDbStats(db);
    assert.ok(stats.total >= 1);
    assert.ok(stats.active >= 1);
  });

  it('supports forget and prune operations', () => {
    const db = getDb(dbPath);

    const id = insertMemory(db, {
      category: 'bug',
      content: 'Temporary bug description to forget',
      summary: 'Temporary bug summary',
      file_path: 'src/temp.ts',
      status: 'active',
    });

    // Soft forget (deprecate)
    const forgetRes = forgetMemory(db, { id, hardDelete: false });
    assert.equal(forgetRes.count, 1);
    const forgotten = getMemoryById(db, id);
    assert.equal(forgotten.status, 'deprecated');

    // Prune deprecated memories
    const pruned = pruneByStatus(db, 'deprecated');
    assert.ok(pruned >= 1);
    const missing = getMemoryById(db, id);
    assert.equal(missing, null);
  });
});
